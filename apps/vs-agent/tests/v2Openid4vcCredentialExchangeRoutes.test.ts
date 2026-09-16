import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IssuerService,
  OpenId4VcIssuerRequestError,
  UnknownCredentialConfigurationError,
  UnknownIssuanceSessionError,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { ErrorEnvelopeFilter } from '../src/common'
import { encodeCursor, hashScope } from '../src/common/pagination/cursor'
import {
  Openid4vcCredentialOfferBodyDto,
  Openid4vcListCredentialExchangesQueryDto,
} from '../src/controllers/admin/v2/openid4vc/dto'
import { V2Openid4vcCredentialExchangesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'

function session(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    credentialConfigurationId: 'employee',
    state: 'OfferCreated',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

const sessions = [
  session('ce-a', '2026-01-01T00:00:00.000Z'),
  session('ce-b', '2026-01-01T00:01:00.000Z', { state: 'Completed' }),
  session('ce-c', '2026-01-01T00:02:00.000Z', { credentialConfigurationId: 'badge' }),
]

const issuerService = {
  createOffer: vi.fn(),
  getIssuanceSession: vi.fn(),
  listIssuanceSessions: vi.fn(),
  deleteIssuanceSession: vi.fn(),
}

async function createApp(withIssuer: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [V2Openid4vcCredentialExchangesController],
    providers: withIssuer ? [{ provide: IssuerService, useValue: issuerService }] : [],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(new ValidationPipe())
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  await app.init()
  return app
}

describe('v2 openid4vc credential exchange routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp(true)
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    issuerService.listIssuanceSessions.mockResolvedValue(sessions)
    issuerService.getIssuanceSession.mockResolvedValue(sessions[0])
    issuerService.createOffer.mockResolvedValue({
      credentialOffer:
        'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fagent.test%2Foffers%2F1',
      issuanceSessionId: 'ce-new',
    })
    issuerService.deleteIssuanceSession.mockResolvedValue(undefined)
  })

  it('walks the credential exchanges with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges?limit=2')

    expect(first.status).toBe(200)
    expect(
      first.body.items.map((item: { credentialExchangeId: string }) => item.credentialExchangeId),
    ).toEqual(['ce-a', 'ce-b'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/openid4vc/credential-exchanges?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(
      second.body.items.map((item: { credentialExchangeId: string }) => item.credentialExchangeId),
    ).toEqual(['ce-c'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('sends every field that the specification names and nothing about the offer content', async () => {
    const response = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges?limit=1')

    expect(Object.keys(response.body.items[0]).sort()).toEqual(
      [
        'createdAt',
        'credentialConfigurationId',
        'credentialExchangeId',
        'expiresAt',
        'state',
        'updatedAt',
      ].sort(),
    )
    expect(response.body.items[0]).toMatchObject({
      credentialExchangeId: 'ce-a',
      credentialConfigurationId: 'employee',
      state: 'OfferCreated',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('filters by state and by credential configuration', async () => {
    const byState = await request(app.getHttpServer()).get(
      '/v2/openid4vc/credential-exchanges?state=Completed',
    )
    expect(
      byState.body.items.map((item: { credentialExchangeId: string }) => item.credentialExchangeId),
    ).toEqual(['ce-b'])

    const byConfiguration = await request(app.getHttpServer()).get(
      '/v2/openid4vc/credential-exchanges?credentialConfigurationId=badge',
    )
    expect(
      byConfiguration.body.items.map((item: { credentialExchangeId: string }) => item.credentialExchangeId),
    ).toEqual(['ce-c'])
  })

  it('refuses an unknown state filter', async () => {
    const errors = await validate(
      plainToInstance(Openid4vcListCredentialExchangesQueryDto, { state: 'Done' }),
    )
    expect(errors.map(error => error.property)).toEqual(['state'])
  })

  it('refuses a cursor minted under another filter', async () => {
    const first = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges?limit=1')
    const replay = await request(app.getHttpServer()).get(
      `/v2/openid4vc/credential-exchanges?limit=1&state=Completed&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )
    expect(replay.status).toBe(400)
    expect(replay.body.error.code).toBe('INVALID_CURSOR')
  })

  it('refuses a cursor minted by the didcomm credential exchanges scope', async () => {
    const cursor = encodeCursor(
      hashScope({ method: 'listCredentialExchanges' }),
      '2026-01-01T00:00:00.000Z|ce-a',
    )
    const response = await request(app.getHttpServer()).get(
      `/v2/openid4vc/credential-exchanges?cursor=${encodeURIComponent(cursor)}`,
    )
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_CURSOR')
  })

  it('gets one credential exchange by identifier and answers UNKNOWN_ID otherwise', async () => {
    const found = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges/ce-a')
    expect(found.status).toBe(200)
    expect(found.body.credentialExchangeId).toBe('ce-a')
    expect(issuerService.getIssuanceSession).toHaveBeenCalledWith('ce-a')

    issuerService.getIssuanceSession.mockRejectedValue(new UnknownIssuanceSessionError('unknown'))
    const missing = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges/nope')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({
      error: { code: 'UNKNOWN_ID', message: 'no credential exchange with id "nope"' },
    })
  })

  it('creates a credential offer and returns the exchange id and the offer URL', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/openid4vc/credential-offer')
      .send({
        credentialConfigurationId: 'employee',
        claims: { name: 'Ada Lovelace', role: 'engineer' },
        ttlSeconds: 3600,
      })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      credentialExchangeId: 'ce-new',
      url: 'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fagent.test%2Foffers%2F1',
    })
    expect(issuerService.createOffer).toHaveBeenCalledWith(
      'employee',
      { name: 'Ada Lovelace', role: 'engineer' },
      3600,
    )
  })

  it('maps an unknown configuration to UNKNOWN_CONFIGURATION and a claim error to INVALID_INPUT', async () => {
    issuerService.createOffer.mockRejectedValueOnce(
      new UnknownCredentialConfigurationError("unknown credential configuration 'x'"),
    )
    const unknown = await request(app.getHttpServer())
      .post('/v2/openid4vc/credential-offer')
      .send({ credentialConfigurationId: 'x', claims: { name: 'Ada' }, ttlSeconds: 3600 })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toEqual({
      code: 'UNKNOWN_CONFIGURATION',
      message: "unknown credential configuration 'x'",
    })

    issuerService.createOffer.mockRejectedValueOnce(new OpenId4VcIssuerRequestError("unknown claim 'age'"))
    const badClaims = await request(app.getHttpServer())
      .post('/v2/openid4vc/credential-offer')
      .send({ credentialConfigurationId: 'employee', claims: { age: 3 }, ttlSeconds: 3600 })
    expect(badClaims.status).toBe(400)
    expect(badClaims.body.error).toEqual({ code: 'INVALID_INPUT', message: "unknown claim 'age'" })
  })

  it('validates the offer body and refuses fields the specification does not define', async () => {
    const missing = await validate(
      plainToInstance(Openid4vcCredentialOfferBodyDto, { credentialConfigurationId: 'employee' }),
    )
    expect(missing.map(error => error.property)).toEqual(['claims', 'ttlSeconds'])

    const outOfRange = await validate(
      plainToInstance(Openid4vcCredentialOfferBodyDto, {
        credentialConfigurationId: 'employee',
        claims: { name: 'Ada' },
        ttlSeconds: 5,
      }),
    )
    expect(outOfRange.map(error => error.property)).toEqual(['ttlSeconds'])

    const extra = await validate(
      plainToInstance(Openid4vcCredentialOfferBodyDto, {
        credentialConfigurationId: 'employee',
        claims: { name: 'Ada' },
        ttlSeconds: 3600,
        statusListId: 'list-1',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    )
    expect(extra.map(error => error.property)).toEqual(['statusListId'])
  })

  it('deletes a credential exchange with 204 and answers UNKNOWN_ID otherwise', async () => {
    const deleted = await request(app.getHttpServer()).delete('/v2/openid4vc/credential-exchanges/ce-a')
    expect(deleted.status).toBe(204)
    expect(deleted.text).toBe('')
    expect(issuerService.deleteIssuanceSession).toHaveBeenCalledWith('ce-a')

    issuerService.deleteIssuanceSession.mockRejectedValue(new UnknownIssuanceSessionError('unknown'))
    const missing = await request(app.getHttpServer()).delete('/v2/openid4vc/credential-exchanges/nope')
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('UNKNOWN_ID')
  })
})

describe('v2 openid4vc credential exchange routes without an issuer capability', () => {
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
          .post('/v2/openid4vc/credential-offer')
          .send({ credentialConfigurationId: 'employee', claims: { name: 'Ada' }, ttlSeconds: 3600 }),
      () => request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges'),
      () => request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges/ce-a'),
      () => request(app.getHttpServer()).delete('/v2/openid4vc/credential-exchanges/ce-a'),
    ]

    for (const send of requests) {
      const response = await send()
      expect(response.status).toBe(409)
      expect(response.body).toEqual({
        error: {
          code: 'CAPABILITY_NOT_CONFIGURED',
          message: 'the OpenID4VC configuration defines no issuer capability',
        },
      })
    }
  })
})
