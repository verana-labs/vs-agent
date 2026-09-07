import type { INestApplication } from '@nestjs/common'

import { Secp256k1HdWallet, makeSignDoc } from '@cosmjs/amino'
import { toBase64, toUtf8 } from '@cosmjs/encoding'
import { Controller, Get } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { V2AuthController } from '../../src/controllers/admin/v2/auth/V2AuthController'
import { AdminAuthGuard } from '../../src/security/AdminAuthGuard'
import { AdminAuthService, challengePayload } from '../../src/security/AdminAuthService'
import { commonAppConfig } from '../../src/utils/setupAgent'

@Controller({ path: 'vt/flows', version: '2' })
class TestFlowsController {
  @Get()
  listFlows(): { ok: boolean } {
    return { ok: true }
  }
}

async function makeApp(authMode: string, allowedAccounts: string[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [V2AuthController, TestFlowsController],
    providers: [
      AdminAuthService,
      { provide: 'ADMIN_AUTH_MODE', useValue: authMode },
      { provide: 'ADMIN_TRUSTED_NETWORKS', useValue: [] },
      { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: allowedAccounts },
      { provide: APP_GUARD, useClass: AdminAuthGuard },
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  commonAppConfig(app, false, true, false)
  await app.init()
  return app
}

async function signChallenge(wallet: Secp256k1HdWallet, account: string, nonce: string) {
  const signDoc = makeSignDoc(
    [
      {
        type: 'sign/MsgSignData',
        value: { signer: account, data: toBase64(toUtf8(challengePayload(nonce))) },
      },
    ],
    { gas: '0', amount: [] },
    '',
    '',
    0,
    0,
  )
  const { signature } = await wallet.signAmino(account, signDoc)
  return { pubKey: signature.pub_key.value, signature: signature.signature }
}

async function authenticate(app: INestApplication, wallet: Secp256k1HdWallet, account: string) {
  const challenge = await request(app.getHttpServer()).post('/v2/auth/challenge').send({ account })
  expect(challenge.status).toBe(201)
  const signed = await signChallenge(wallet, account, challenge.body.nonce)
  return request(app.getHttpServer())
    .post('/v2/auth/token')
    .send({ account, nonce: challenge.body.nonce, ...signed })
}

describe('admin API auth: ADR-036 challenge to allowlisted call from an external peer', () => {
  let app: INestApplication
  let callerWallet: Secp256k1HdWallet
  let callerAccount: string

  beforeAll(async () => {
    callerWallet = await Secp256k1HdWallet.generate(12, { prefix: 'verana' })
    const [{ address }] = await callerWallet.getAccounts()
    callerAccount = address
    app = await makeApp('corporation', [callerAccount])
  })

  afterAll(async () => {
    await app?.close()
  })

  it('walks challenge, token, and the allowlist check', async () => {
    const unauthenticated = await request(app.getHttpServer()).get('/v2/vt/flows')
    expect(unauthenticated.status).toBe(401)

    const token = await authenticate(app, callerWallet, callerAccount)
    expect(token.status).toBe(201)
    expect(token.body.token).toBeTruthy()

    const authorized = await request(app.getHttpServer())
      .get('/v2/vt/flows')
      .set('Authorization', `Bearer ${token.body.token}`)
    expect(authorized.status).toBe(200)
    expect(authorized.body).toEqual({ ok: true })

    const strangerWallet = await Secp256k1HdWallet.generate(12, { prefix: 'verana' })
    const [{ address: strangerAccount }] = await strangerWallet.getAccounts()
    const strangerToken = await authenticate(app, strangerWallet, strangerAccount)
    expect(strangerToken.status).toBe(201)
    const denied = await request(app.getHttpServer())
      .get('/v2/vt/flows')
      .set('Authorization', `Bearer ${strangerToken.body.token}`)
    expect(denied.status).toBe(403)
  })

  it('envelopes an invalid challenge account as INVALID_INPUT', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/auth/challenge')
      .send({ account: 'cosmos1notverana' })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: { code: 'INVALID_INPUT', message: 'account must be a verana address' },
    })
  })

  it('envelopes a failed token exchange as UNAUTHENTICATED without distinguishing the cause', async () => {
    const signed = await signChallenge(callerWallet, callerAccount, 'unknown-nonce')
    const response = await request(app.getHttpServer())
      .post('/v2/auth/token')
      .send({ account: callerAccount, nonce: 'unknown-nonce', ...signed })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'challenge verification failed' },
    })
  })

  it('rejects every external request with 403 in internal mode, auth methods included', async () => {
    const internalApp = await makeApp('internal', [])
    try {
      const flows = await request(internalApp.getHttpServer()).get('/v2/vt/flows')
      expect(flows.status).toBe(403)

      const challenge = await request(internalApp.getHttpServer())
        .post('/v2/auth/challenge')
        .send({ account: callerAccount })
      expect(challenge.status).toBe(403)
    } finally {
      await internalApp.close()
    }
  })
})
