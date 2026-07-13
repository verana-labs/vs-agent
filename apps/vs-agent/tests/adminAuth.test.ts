import type { ExecutionContext } from '@nestjs/common'

import { makeSignDoc, rawSecp256k1PubkeyToRawAddress, serializeSignDoc } from '@cosmjs/amino'
import { Secp256k1, sha256 } from '@cosmjs/crypto'
import { toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'

import { AdminAuthGuard } from '../src/security/AdminAuthGuard'
import { AdminAuthService, challengePayload } from '../src/security/AdminAuthService'
import { ACCESS_MODE_KEY, type AccessModeMetadata } from '../src/security/accessMode'

async function makeSigner() {
  const keypair = await Secp256k1.makeKeypair(sha256(toUtf8('admin-auth-test-seed')))
  const pubkey = Secp256k1.compressPubkey(keypair.pubkey)
  const signer = toBech32('verana', rawSecp256k1PubkeyToRawAddress(pubkey))
  const sign = async (data: string): Promise<string> => {
    const signDoc = makeSignDoc(
      [{ type: 'sign/MsgSignData', value: { signer, data: toBase64(toUtf8(data)) } }],
      { gas: '0', amount: [] },
      '',
      '',
      0,
      0,
    )
    const signature = await Secp256k1.createSignature(sha256(serializeSignDoc(signDoc)), keypair.privkey)
    return toBase64(signature.toFixedLength().slice(0, 64))
  }
  return { signer, pubKey: toBase64(pubkey), sign }
}

async function issueToken(authService: AdminAuthService) {
  const { signer, pubKey, sign } = await makeSigner()
  const { nonce } = authService.createChallenge(signer)
  const signature = await sign(challengePayload(nonce))
  const issued = await authService.issueToken({ account: signer, pubKey, signature, nonce })
  return { account: signer, token: issued!.token }
}

function makeContext(metadata: AccessModeMetadata | undefined, headers: Record<string, string> = {}) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => (key === ACCESS_MODE_KEY ? metadata : undefined)),
  } as unknown as Reflector
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ headers, params: { participantSessionId: 'sess-1' } }),
    }),
  } as unknown as ExecutionContext
  return { reflector, context }
}

function makeAgent(callerHoldsVsOperatorGrant = vi.fn().mockResolvedValue(true)) {
  return {
    authorizationService: { callerHoldsVsOperatorGrant },
    veranaChain: { getParticipant: vi.fn().mockResolvedValue({ id: 42, validatorParticipantId: 9 }) },
    dependencyManager: {
      resolve: () => ({ findAllByQuery: vi.fn().mockResolvedValue([{ participantId: '42' }]) }),
    },
  }
}

const CORPORATION_META: AccessModeMetadata = {
  mode: 'CORPORATION',
  msgTypes: ['/verana.pp.v1.MsgSetParticipantOPToValidated'],
}

describe('AdminAuthService', () => {
  it('issues a token for a correctly signed challenge and rejects nonce reuse', async () => {
    const authService = new AdminAuthService()
    const { signer, pubKey, sign } = await makeSigner()
    const { nonce } = authService.createChallenge(signer)
    const signature = await sign(challengePayload(nonce))

    const issued = await authService.issueToken({ account: signer, pubKey, signature, nonce })
    expect(issued?.token).toBeTruthy()
    expect(authService.resolveAccount(issued!.token)).toBe(signer)

    const replayed = await authService.issueToken({ account: signer, pubKey, signature, nonce })
    expect(replayed).toBeUndefined()
  })

  it('rejects a signature over the wrong challenge', async () => {
    const authService = new AdminAuthService()
    const { signer, pubKey, sign } = await makeSigner()
    const { nonce } = authService.createChallenge(signer)
    const signature = await sign(challengePayload('other-nonce'))

    await expect(authService.issueToken({ account: signer, pubKey, signature, nonce })).resolves.toBe(
      undefined,
    )
  })
})

describe('AdminAuthGuard', () => {
  it('allows PUBLIC routes without a token', async () => {
    const authService = new AdminAuthService()
    const { reflector, context } = makeContext({ mode: 'PUBLIC' })
    const guard = new AdminAuthGuard(reflector, authService, makeAgent() as never, [])

    await expect(guard.canActivate(context)).resolves.toBe(true)
  })

  it('rejects requests without a valid bearer token', async () => {
    const authService = new AdminAuthService()
    const { reflector, context } = makeContext(CORPORATION_META)
    const guard = new AdminAuthGuard(reflector, authService, makeAgent() as never, [])

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects INTERNAL routes on the external listener even when authenticated', async () => {
    const authService = new AdminAuthService()
    const { token } = await issueToken(authService)
    const { reflector, context } = makeContext(undefined, { authorization: `Bearer ${token}` })
    const guard = new AdminAuthGuard(reflector, authService, makeAgent() as never, [])

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('this method is only available on the internal listener'),
    )
  })

  it('rejects accounts outside the allowed accounts list', async () => {
    const authService = new AdminAuthService()
    const { token } = await issueToken(authService)
    const { reflector, context } = makeContext(CORPORATION_META, { authorization: `Bearer ${token}` })
    const guard = new AdminAuthGuard(reflector, authService, makeAgent() as never, ['verana1someoneelse'])

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('account is not in the allowed accounts list'),
    )
  })

  it('allows a CORPORATION route when the caller holds the required grant for the flow validator', async () => {
    const authService = new AdminAuthService()
    const { account, token } = await issueToken(authService)
    const callerCheck = vi.fn().mockResolvedValue(true)
    const agent = makeAgent(callerCheck)
    const { reflector, context } = makeContext(CORPORATION_META, { authorization: `Bearer ${token}` })
    const guard = new AdminAuthGuard(reflector, authService, agent as never, [])

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(callerCheck).toHaveBeenCalledWith(account, 9, '/verana.pp.v1.MsgSetParticipantOPToValidated')
  })

  it('rejects a CORPORATION route when the caller holds no matching grant', async () => {
    const authService = new AdminAuthService()
    const { token } = await issueToken(authService)
    const agent = makeAgent(vi.fn().mockResolvedValue(false))
    const { reflector, context } = makeContext(CORPORATION_META, { authorization: `Bearer ${token}` })
    const guard = new AdminAuthGuard(reflector, authService, agent as never, [])

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('account holds no authorization covering this method'),
    )
  })
})
