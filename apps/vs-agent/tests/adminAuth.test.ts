import type { ExecutionContext } from '@nestjs/common'

import { makeSignDoc, rawSecp256k1PubkeyToRawAddress, serializeSignDoc } from '@cosmjs/amino'
import { Secp256k1, sha256 } from '@cosmjs/crypto'
import { toBase64, toBech32, toUtf8 } from '@cosmjs/encoding'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'

import { AdminAuthGuard } from '../src/security/AdminAuthGuard'
import { AdminAuthService, challengePayload } from '../src/security/AdminAuthService'
import { ADMIN_AUTH_EXEMPT_KEY, type AdminAuthExemption } from '../src/security/adminAuthExempt'
import {
  DEFAULT_ADMIN_API_TRUSTED_NETWORKS,
  isTrustedPeer,
  parseTrustedNetworks,
} from '../src/security/trustedNetworks'

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

function makeContext(
  exemption: AdminAuthExemption | undefined,
  options: { headers?: Record<string, string>; remoteAddress?: string | undefined } = {},
) {
  const headers = options.headers ?? {}
  const remoteAddress = 'remoteAddress' in options ? options.remoteAddress : '203.0.113.5'
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => (key === ADMIN_AUTH_EXEMPT_KEY ? exemption : undefined)),
  } as unknown as Reflector
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ headers, socket: { remoteAddress } }),
    }),
  } as unknown as ExecutionContext
  return { reflector, context }
}

function makeGuard(
  reflector: Reflector,
  options: {
    authService?: AdminAuthService
    authMode?: 'internal' | 'corporation'
    trustedNetworks?: string[]
    allowedAccounts?: string[]
  } = {},
): AdminAuthGuard {
  return new AdminAuthGuard(
    reflector,
    options.authService ?? new AdminAuthService(),
    options.authMode ?? 'internal',
    parseTrustedNetworks(options.trustedNetworks ?? DEFAULT_ADMIN_API_TRUSTED_NETWORKS),
    options.allowedAccounts ?? [],
  )
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

describe('trusted network parsing and classification', () => {
  it('parses the default blocks', () => {
    expect(parseTrustedNetworks(DEFAULT_ADMIN_API_TRUSTED_NETWORKS)).toHaveLength(2)
  })

  it('throws on a malformed CIDR block', () => {
    expect(() => parseTrustedNetworks(['not-a-cidr'])).toThrow()
    expect(() => parseTrustedNetworks(['10.0.0.0/33'])).toThrow()
    expect(() => parseTrustedNetworks(['127.0.0.1'])).toThrow()
  })

  it('matches an IPv4-mapped IPv6 peer against an IPv4 block', () => {
    const networks = parseTrustedNetworks(DEFAULT_ADMIN_API_TRUSTED_NETWORKS)
    expect(isTrustedPeer('::ffff:127.0.0.1', networks)).toBe(true)
  })

  it('fails closed on missing or unparseable peer addresses', () => {
    const networks = parseTrustedNetworks(DEFAULT_ADMIN_API_TRUSTED_NETWORKS)
    expect(isTrustedPeer(undefined, networks)).toBe(false)
    expect(isTrustedPeer('fe80::1%eth0', networks)).toBe(false)
  })
})

describe('AdminAuthGuard', () => {
  it('classifies on the socket peer address and never on X-Forwarded-For', async () => {
    const spoofed = {
      remoteAddress: '203.0.113.5',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }
    const internal = makeContext(undefined, spoofed)
    expect(() => makeGuard(internal.reflector).canActivate(internal.context)).toThrow(ForbiddenException)

    const corporation = makeContext(undefined, spoofed)
    expect(() =>
      makeGuard(corporation.reflector, { authMode: 'corporation' }).canActivate(corporation.context),
    ).toThrow(UnauthorizedException)
  })

  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ])('serves trusted peer %s without a token in both modes', remoteAddress => {
    for (const authMode of ['internal', 'corporation'] as const) {
      const { reflector, context } = makeContext(undefined, { remoteAddress })
      expect(makeGuard(reflector, { authMode }).canActivate(context)).toBe(true)
    }
  })

  it('classifies peers against the configured blocks', () => {
    const trusted = makeContext(undefined, { remoteAddress: '10.1.2.3' })
    expect(
      makeGuard(trusted.reflector, { trustedNetworks: ['10.0.0.0/8'] }).canActivate(trusted.context),
    ).toBe(true)

    const external = makeContext(undefined, { remoteAddress: '192.168.1.1' })
    expect(() =>
      makeGuard(external.reflector, { trustedNetworks: ['10.0.0.0/8'] }).canActivate(external.context),
    ).toThrow(ForbiddenException)
  })

  it('classifies missing and unparseable peer addresses as external', () => {
    for (const remoteAddress of [undefined, 'fe80::1%eth0']) {
      const { reflector, context } = makeContext(undefined, { remoteAddress })
      expect(() => makeGuard(reflector).canActivate(context)).toThrow(ForbiddenException)
    }
  })

  it('rejects an external request with 403 in internal mode even when authenticated', async () => {
    const authService = new AdminAuthService()
    const { token } = await issueToken(authService)
    const { reflector, context } = makeContext(undefined, { headers: { authorization: `Bearer ${token}` } })
    expect(() => makeGuard(reflector, { authService }).canActivate(context)).toThrow(ForbiddenException)
  })

  it('rejects an external request without a valid bearer token in corporation mode', () => {
    const { reflector, context } = makeContext(undefined)
    expect(() => makeGuard(reflector, { authMode: 'corporation' }).canActivate(context)).toThrow(
      UnauthorizedException,
    )
  })

  it('denies an authenticated account when the allowlist is empty', async () => {
    const authService = new AdminAuthService()
    const { token } = await issueToken(authService)
    const { reflector, context } = makeContext(undefined, { headers: { authorization: `Bearer ${token}` } })
    expect(() =>
      makeGuard(reflector, { authService, authMode: 'corporation', allowedAccounts: [] }).canActivate(
        context,
      ),
    ).toThrow(new ForbiddenException('account is not in the allowed accounts list'))
  })

  it('denies an authenticated account outside the allowlist and serves one inside it', async () => {
    const authService = new AdminAuthService()
    const { account, token } = await issueToken(authService)

    const denied = makeContext(undefined, { headers: { authorization: `Bearer ${token}` } })
    expect(() =>
      makeGuard(denied.reflector, {
        authService,
        authMode: 'corporation',
        allowedAccounts: ['verana1someoneelse'],
      }).canActivate(denied.context),
    ).toThrow(ForbiddenException)

    const served = makeContext(undefined, { headers: { authorization: `Bearer ${token}` } })
    expect(
      makeGuard(served.reflector, {
        authService,
        authMode: 'corporation',
        allowedAccounts: [account],
      }).canActivate(served.context),
    ).toBe(true)
  })

  it('serves a corporation-exempt method to an external caller in corporation mode only', () => {
    const served = makeContext('corporation')
    expect(makeGuard(served.reflector, { authMode: 'corporation' }).canActivate(served.context)).toBe(true)

    const rejected = makeContext('corporation')
    expect(() => makeGuard(rejected.reflector).canActivate(rejected.context)).toThrow(ForbiddenException)
  })

  it('serves an always-exempt method to an external caller in both modes', () => {
    for (const authMode of ['internal', 'corporation'] as const) {
      const { reflector, context } = makeContext('always')
      expect(makeGuard(reflector, { authMode }).canActivate(context)).toBe(true)
    }
  })
})
