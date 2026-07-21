import type { INestApplication } from '@nestjs/common'

import { Secp256k1HdWallet, makeSignDoc } from '@cosmjs/amino'
import { toBase64, toUtf8 } from '@cosmjs/encoding'
import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { Controller, HttpCode, HttpStatus, Post, VersioningType } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { AuthorizationService, VeranaChainService } from '@verana-labs/vs-agent-sdk'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PARTICIPANT_ROLE_HOLDER,
  PARTICIPANT_ROLE_ISSUER,
  VeranaTestChain,
} from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import {
  COOLUSER_MNEMONIC,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from '../../../../packages/agent-sdk/tests/e2e/helpers'
import { AdminAuthGuard } from '../../src/security/AdminAuthGuard'
import { AdminAuthService, challengePayload } from '../../src/security/AdminAuthService'
import { AuthController } from '../../src/security/AuthController'
import { AccessMode } from '../../src/security/accessMode'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const MINIMAL_SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AdminAuthTestCredential',
  description: 'admin auth e2e',
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
})

@Controller({ path: 'vt/flows', version: '1' })
class TestFlowsController {
  @Post(':participantSessionId/validate')
  @AccessMode('CORPORATION', [PP_VALIDATE])
  @HttpCode(HttpStatus.OK)
  validate(): { ok: boolean } {
    return { ok: true }
  }
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
  const challenge = await request(app.getHttpServer()).post('/v1/auth/challenge').send({ account })
  expect(challenge.status).toBe(201)
  const signed = await signChallenge(wallet, account, challenge.body.nonce)
  const token = await request(app.getHttpServer())
    .post('/v1/auth/token')
    .send({ account, nonce: challenge.body.nonce, ...signed })
  return token
}

describeE2E('admin API auth (V4): ADR-036 challenge to authorized call against a live chain', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let veranaChain: VeranaChainService
  let app: INestApplication
  let callerWallet: Secp256k1HdWallet
  let callerAccount: string

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)

    callerWallet = await Secp256k1HdWallet.generate(12, { prefix: 'verana' })
    const [{ address }] = await callerWallet.getAccounts()
    callerAccount = address

    const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
    await chainA.fundCorporation(corp.policyAddress)
    await chainA.grantOperatorAuthorization(corp.policyAddress)
    const eco = await chainA.createEcosystem(corp.policyAddress, { did: `did:example:eco-${RUN_ID}` })
    const schema = await chainA.createCredentialSchema(corp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: MINIMAL_SCHEMA,
    })
    const root = await chainA.createRootParticipant(corp.policyAddress, {
      schemaId: schema.schemaId,
      did: `did:example:root-${RUN_ID}`,
    })

    veranaChain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: corp.policyAddress,
      logger: new ConsoleLogger(LogLevel.Warn),
    })
    await veranaChain.start()

    const validator = await chainA.startParticipantOp(corp.policyAddress, {
      role: PARTICIPANT_ROLE_ISSUER,
      validatorParticipantId: root.participantId,
      did: `did:example:flow-validator-${RUN_ID}`,
      vsOperator: callerAccount,
      vsOperatorAuthzMsgTypes: [PP_VALIDATE],
    })
    await veranaChain.setParticipantOPToValidated({
      id: validator.participantId,
      opSummaryDigest: 'sha384-x',
    })

    const applicant = await chainA.startParticipantOp(corp.policyAddress, {
      role: PARTICIPANT_ROLE_HOLDER,
      validatorParticipantId: validator.participantId,
      did: `did:example:flow-applicant-${RUN_ID}`,
    })

    const agentStub = {
      authorizationService: new AuthorizationService({
        chain: veranaChain,
        logger: new ConsoleLogger(LogLevel.Warn),
        corporationId: corp.corporationId,
      }),
      veranaChain,
      dependencyManager: {
        resolve: () => ({ findAllByQuery: async () => [{ participantId: String(applicant.participantId) }] }),
      },
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, TestFlowsController],
      providers: [
        AdminAuthService,
        { provide: 'VSAGENT', useValue: agentStub },
        { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: [] },
        { provide: APP_GUARD, useClass: AdminAuthGuard },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    await app.init()
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await app?.close()
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'walks challenge, token, and authorization against the live chain',
    async () => {
      const token = await authenticate(app, callerWallet, callerAccount)
      expect(token.status).toBe(201)
      expect(token.body.token).toBeTruthy()
      const bearer = `Bearer ${token.body.token}`

      const unauthenticated = await request(app.getHttpServer()).post('/v1/vt/flows/sess-1/validate')
      expect(unauthenticated.status).toBe(401)

      const authorized = await request(app.getHttpServer())
        .post('/v1/vt/flows/sess-1/validate')
        .set('Authorization', bearer)
      expect(authorized.status).toBe(200)
      expect(authorized.body).toEqual({ ok: true })

      const strangerWallet = await Secp256k1HdWallet.generate(12, { prefix: 'verana' })
      const [{ address: strangerAccount }] = await strangerWallet.getAccounts()
      const strangerToken = await authenticate(app, strangerWallet, strangerAccount)
      expect(strangerToken.status).toBe(201)
      const denied = await request(app.getHttpServer())
        .post('/v1/vt/flows/sess-1/validate')
        .set('Authorization', `Bearer ${strangerToken.body.token}`)
      expect(denied.status).toBe(403)
    },
    SETUP_TIMEOUT_MS,
  )
})
