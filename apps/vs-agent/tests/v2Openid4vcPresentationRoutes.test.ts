import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  OpenId4VcVerifierRequestError,
  UnknownVerificationSessionError,
  UnknownVerifierPolicyError,
  VerifierService,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { ErrorEnvelopeFilter } from '../src/common'
import {
  Openid4vcListPresentationsQueryDto,
  Openid4vcPresentationRequestBodyDto,
} from '../src/controllers/admin/v2/openid4vc/dto'
import { V2Openid4vcPresentationsController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'

const AUTHORIZATION_REQUEST =
  'openid4vp://authorize?request_uri=https%3A%2F%2Fagent.test%2Foid4vp%2Fverifier%2Fauthorization-requests%2F1'

const trust = {
  verdict: 'TRUSTED_AUTHORIZED',
  evidence: {
    did: 'did:web:issuer.example',
    trustStatus: 'TRUSTED',
    vtjscId: 'https://trust.example/vtjsc/employee',
    authorized: true,
    queries: ['resolve', 'issuer-authorization'],
  },
}

function session(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    policyId: 'employee-check',
    state: 'RequestCreated',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    cryptographicVerified: false,
    accepted: false,
    ...overrides,
  }
}

const sessions = [
  session('pe-a', '2026-01-01T00:00:00.000Z'),
  session('pe-b', '2026-01-01T00:01:00.000Z', {
    state: 'ResponseVerified',
    cryptographicVerified: true,
    accepted: true,
    trust,
    credential: {
      vct: 'https://agent.example/oid4vc/vct/employee',
      disclosedClaims: { name: 'Ada Lovelace' },
    },
  }),
  session('pe-c', '2026-01-01T00:02:00.000Z', { policyId: 'badge-check' }),
]

const verifierService = {
  createRequest: vi.fn(),
  getVerificationSession: vi.fn(),
  listVerificationSessions: vi.fn(),
  deleteVerificationSession: vi.fn(),
}

async function createApp(withVerifier: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [V2Openid4vcPresentationsController],
    providers: withVerifier ? [{ provide: VerifierService, useValue: verifierService }] : [],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(new ValidationPipe())
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  await app.init()
  return app
}

function ids(body: { items: { proofExchangeId: string }[] }): string[] {
  return body.items.map(item => item.proofExchangeId)
}

describe('v2 openid4vc presentation routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp(true)
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    verifierService.listVerificationSessions.mockResolvedValue(sessions)
    verifierService.getVerificationSession.mockResolvedValue(sessions[1])
    verifierService.createRequest.mockResolvedValue({
      authorizationRequest: AUTHORIZATION_REQUEST,
      verificationSessionId: 'pe-new',
    })
    verifierService.deleteVerificationSession.mockResolvedValue(undefined)
  })

  it('walks the presentations with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/openid4vc/presentations?limit=2')

    expect(first.status).toBe(200)
    expect(ids(first.body)).toEqual(['pe-a', 'pe-b'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/openid4vc/presentations?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(ids(second.body)).toEqual(['pe-c'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('sends the verified record with its trust verdict and disclosed claims', async () => {
    const response = await request(app.getHttpServer()).get('/v2/openid4vc/presentations/pe-b')

    expect(response.status).toBe(200)
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'accepted',
        'createdAt',
        'credential',
        'cryptographicVerified',
        'policyId',
        'proofExchangeId',
        'state',
        'trust',
        'updatedAt',
      ].sort(),
    )
    expect(response.body.trust).toEqual(trust)
    expect(response.body.credential.disclosedClaims).toEqual({ name: 'Ada Lovelace' })
    expect(response.body.accepted).toBe(true)
  })

  it('omits trust and credential while the session is pending', async () => {
    verifierService.getVerificationSession.mockResolvedValue(sessions[0])

    const response = await request(app.getHttpServer()).get('/v2/openid4vc/presentations/pe-a')

    expect(response.status).toBe(200)
    expect(response.body).not.toHaveProperty('trust')
    expect(response.body).not.toHaveProperty('credential')
    expect(response.body).toMatchObject({ proofExchangeId: 'pe-a', state: 'RequestCreated', accepted: false })
  })

  it('filters by policy and by state', async () => {
    const byPolicy = await request(app.getHttpServer()).get(
      '/v2/openid4vc/presentations?policyId=badge-check',
    )
    expect(ids(byPolicy.body)).toEqual(['pe-c'])

    const byState = await request(app.getHttpServer()).get(
      '/v2/openid4vc/presentations?state=ResponseVerified',
    )
    expect(ids(byState.body)).toEqual(['pe-b'])
  })

  it('refuses an unknown state filter', async () => {
    const errors = await validate(plainToInstance(Openid4vcListPresentationsQueryDto, { state: 'Done' }))
    expect(errors.map(error => error.property)).toEqual(['state'])
  })

  it('creates a presentation request with the optional query language and signer', async () => {
    const full = await request(app.getHttpServer())
      .post('/v2/openid4vc/presentation-request')
      .send({ policyId: 'employee-check', queryLanguage: 'presentation_exchange', requestSigner: 'x5c' })

    expect(full.status).toBe(201)
    expect(full.body).toEqual({ proofExchangeId: 'pe-new', url: AUTHORIZATION_REQUEST })
    expect(verifierService.createRequest).toHaveBeenCalledWith(
      'employee-check',
      'presentation_exchange',
      'x5c',
    )

    const bare = await request(app.getHttpServer())
      .post('/v2/openid4vc/presentation-request')
      .send({ policyId: 'employee-check' })

    expect(bare.status).toBe(201)
    expect(verifierService.createRequest).toHaveBeenLastCalledWith('employee-check', undefined, undefined)
  })

  it('maps an unknown policy to UNKNOWN_POLICY and a signer problem to INVALID_STATE', async () => {
    verifierService.createRequest.mockRejectedValueOnce(
      new UnknownVerifierPolicyError("unknown verifier policy 'x'"),
    )
    const unknown = await request(app.getHttpServer())
      .post('/v2/openid4vc/presentation-request')
      .send({ policyId: 'x' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toEqual({ code: 'UNKNOWN_POLICY', message: "unknown verifier policy 'x'" })

    verifierService.createRequest.mockRejectedValueOnce(
      new OpenId4VcVerifierRequestError(
        'verifier is configured to sign requests with its DID, but the DID does not publish the signing key for authentication',
      ),
    )
    const unsigned = await request(app.getHttpServer())
      .post('/v2/openid4vc/presentation-request')
      .send({ policyId: 'employee-check', requestSigner: 'did' })
    expect(unsigned.status).toBe(409)
    expect(unsigned.body.error.code).toBe('INVALID_STATE')
  })

  it('validates the request body and refuses fields the specification does not define', async () => {
    const badLanguage = await validate(
      plainToInstance(Openid4vcPresentationRequestBodyDto, {
        policyId: 'employee-check',
        queryLanguage: 'sql',
      }),
    )
    expect(badLanguage.map(error => error.property)).toEqual(['queryLanguage'])

    const extra = await validate(
      plainToInstance(Openid4vcPresentationRequestBodyDto, {
        policyId: 'employee-check',
        responseMode: 'direct_post',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    )
    expect(extra.map(error => error.property)).toEqual(['responseMode'])

    const empty = await validate(plainToInstance(Openid4vcPresentationRequestBodyDto, {}))
    expect(empty.map(error => error.property)).toEqual(['policyId'])
  })

  it('answers UNKNOWN_ID for an unknown presentation on get and delete', async () => {
    verifierService.getVerificationSession.mockRejectedValue(new UnknownVerificationSessionError('unknown'))
    verifierService.deleteVerificationSession.mockRejectedValue(
      new UnknownVerificationSessionError('unknown'),
    )

    const read = await request(app.getHttpServer()).get('/v2/openid4vc/presentations/nope')
    expect(read.status).toBe(404)
    expect(read.body).toEqual({ error: { code: 'UNKNOWN_ID', message: 'no presentation with id "nope"' } })

    const deleted = await request(app.getHttpServer()).delete('/v2/openid4vc/presentations/nope')
    expect(deleted.status).toBe(404)
    expect(deleted.body.error.code).toBe('UNKNOWN_ID')
  })

  it('deletes a presentation with 204', async () => {
    const response = await request(app.getHttpServer()).delete('/v2/openid4vc/presentations/pe-a')

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect(verifierService.deleteVerificationSession).toHaveBeenCalledWith('pe-a')
  })
})

describe('v2 openid4vc presentation routes without a verifier capability', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp(false)
  })

  afterAll(async () => {
    await app?.close()
  })

  it('answers CAPABILITY_NOT_CONFIGURED on every method of the module', async () => {
    const requests = [
      () =>
        request(app.getHttpServer())
          .post('/v2/openid4vc/presentation-request')
          .send({ policyId: 'employee-check' }),
      () => request(app.getHttpServer()).get('/v2/openid4vc/presentations'),
      () => request(app.getHttpServer()).get('/v2/openid4vc/presentations/pe-a'),
      () => request(app.getHttpServer()).delete('/v2/openid4vc/presentations/pe-a'),
    ]

    for (const send of requests) {
      const response = await send()
      expect(response.status).toBe(409)
      expect(response.body).toEqual({
        error: {
          code: 'CAPABILITY_NOT_CONFIGURED',
          message: 'the OpenID4VC configuration defines no verifier capability',
        },
      })
    }
  })
})
