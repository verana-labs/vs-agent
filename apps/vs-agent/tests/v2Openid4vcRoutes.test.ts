import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  InvalidPresentationRequestError,
  IssuerService,
  OpenId4VcIssuerRequestError,
  OpenId4VcVerifierRequestError,
  UnknownCredentialConfigurationError,
  UnknownIssuanceSessionError,
  UnknownStatusListError,
  UnknownVerificationSessionError,
  VerifierService,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { ErrorEnvelopeFilter } from '../src/common'
import { encodeCursor, hashScope } from '../src/common/pagination/cursor'
import {
  Openid4vcCredentialOfferBodyDto,
  Openid4vcListCredentialExchangesQueryDto,
  Openid4vcListPresentationsQueryDto,
  Openid4vcPresentationRequestBodyDto,
} from '../src/controllers/admin/v2/openid4vc/dto'
import { V2Openid4vcCredentialExchangesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'

const AUTHORIZATION_REQUEST =
  'openid4vp://authorize?request_uri=https%3A%2F%2Fagent.test%2Foid4vp%2Fverifier%2Fauthorization-requests%2F1'
const CREDENTIAL_OFFER =
  'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fagent.test%2Foffers%2F1'

const trust = {
  verdict: 'TRUSTED_AUTHORIZED',
  evidence: {
    did: 'did:web:issuer.example',
    trustStatus: 'TRUSTED',
    jsonSchemaCredentialId: 'employee',
    authorized: true,
    queries: ['resolve', 'issuer-authorization'],
  },
}

function issuanceSession(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    jsonSchemaCredentialId: 'employee',
    state: 'OfferCreated',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function verificationSession(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    jsonSchemaCredentialId: 'employee',
    requestedClaims: ['name'],
    state: 'RequestCreated',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    cryptographicVerified: false,
    accepted: false,
    ...overrides,
  }
}

const issuanceSessions = [
  issuanceSession('ce-a', '2026-01-01T00:00:00.000Z'),
  issuanceSession('ce-b', '2026-01-01T00:01:00.000Z', { state: 'Completed' }),
  issuanceSession('ce-c', '2026-01-01T00:02:00.000Z', { jsonSchemaCredentialId: 'badge' }),
]

const verificationSessions = [
  verificationSession('pe-a', '2026-01-01T00:00:00.000Z'),
  verificationSession('pe-b', '2026-01-01T00:01:00.000Z', {
    state: 'ResponseVerified',
    cryptographicVerified: true,
    accepted: true,
    trust,
    credential: {
      vct: 'https://agent.example/oid4vc/vct/employee',
      disclosedClaims: { name: 'Ada Lovelace' },
    },
  }),
  verificationSession('pe-c', '2026-01-01T00:02:00.000Z', { jsonSchemaCredentialId: 'badge' }),
]

const issuerCertificate = {
  role: 'issuer',
  development: true,
  fingerprint: `SHA256:${'a'.repeat(64)}`,
  certificateChain: ['MIIB-issuer-leaf'],
}
const verifierCertificate = {
  role: 'verifier',
  development: false,
  fingerprint: `SHA256:${'b'.repeat(64)}`,
  certificateChain: ['MIIB-verifier-leaf', 'MIIB-intermediate', 'MIIB-root'],
}

const issuerService = {
  ensureInitialized: vi.fn().mockResolvedValue(undefined),
  getCertificateInfo: () => issuerCertificate,
  listIssuanceSessions: async () => issuanceSessions,
  createOffer: vi.fn(),
  getIssuanceSession: vi.fn(),
  deleteIssuanceSession: vi.fn(),
}

const verifierService = {
  ensureInitialized: vi.fn().mockResolvedValue(undefined),
  getCertificateInfo: () => verifierCertificate,
  listVerificationSessions: async () => verificationSessions,
  createRequest: vi.fn(),
  getVerificationSession: vi.fn(),
  deleteVerificationSession: vi.fn(),
}

function exchangeIds(body: { items: { credentialExchangeId: string }[] }): string[] {
  return body.items.map(item => item.credentialExchangeId)
}

function proofIds(body: { items: { proofExchangeId: string }[] }): string[] {
  return body.items.map(item => item.proofExchangeId)
}

describe('v2 openid4vc routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        V2Openid4vcCredentialExchangesController,
        V2Openid4vcPresentationsController,
        V2Openid4vcSigningCertificatesController,
      ],
      providers: [
        { provide: IssuerService, useValue: issuerService },
        { provide: VerifierService, useValue: verifierService },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe())
    app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    issuerService.getIssuanceSession.mockResolvedValue(issuanceSessions[0])
    issuerService.createOffer.mockResolvedValue({
      credentialOffer: CREDENTIAL_OFFER,
      issuanceSessionId: 'ce-new',
    })
    issuerService.deleteIssuanceSession.mockResolvedValue(undefined)
    verifierService.getVerificationSession.mockResolvedValue(verificationSessions[1])
    verifierService.createRequest.mockResolvedValue({
      authorizationRequest: AUTHORIZATION_REQUEST,
      verificationSessionId: 'pe-new',
    })
    verifierService.deleteVerificationSession.mockResolvedValue(undefined)
  })

  describe('credential exchanges', () => {
    it('walks the credential exchanges with the keyset cursor and ends with a null cursor', async () => {
      const first = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges?limit=2')

      expect(first.status).toBe(200)
      expect(exchangeIds(first.body)).toEqual(['ce-a', 'ce-b'])
      expect(first.body.nextCursor).not.toBeNull()

      const second = await request(app.getHttpServer()).get(
        `/v2/openid4vc/credential-exchanges?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )

      expect(second.status).toBe(200)
      expect(exchangeIds(second.body)).toEqual(['ce-c'])
      expect(second.body.nextCursor).toBeNull()
    })

    it('sends every field that the specification names and nothing about the offer content', async () => {
      const response = await request(app.getHttpServer()).get('/v2/openid4vc/credential-exchanges?limit=1')

      expect(Object.keys(response.body.items[0]).sort()).toEqual(
        [
          'createdAt',
          'credentialExchangeId',
          'expiresAt',
          'jsonSchemaCredentialId',
          'state',
          'updatedAt',
        ].sort(),
      )
      expect(response.body.items[0]).toMatchObject({
        credentialExchangeId: 'ce-a',
        jsonSchemaCredentialId: 'employee',
        state: 'OfferCreated',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z',
      })
    })

    it('filters by state, by credential type and by status list', async () => {
      const byState = await request(app.getHttpServer()).get(
        '/v2/openid4vc/credential-exchanges?state=Completed',
      )
      expect(exchangeIds(byState.body)).toEqual(['ce-b'])

      const byType = await request(app.getHttpServer()).get(
        '/v2/openid4vc/credential-exchanges?jsonSchemaCredentialId=badge',
      )
      expect(exchangeIds(byType.body)).toEqual(['ce-c'])

      const byStatusList = await request(app.getHttpServer()).get(
        '/v2/openid4vc/credential-exchanges?statusListId=list-1',
      )
      expect(exchangeIds(byStatusList.body)).toEqual([])
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
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada Lovelace', role: 'engineer' },
          ttlSeconds: 3600,
        })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({ credentialExchangeId: 'ce-new', url: CREDENTIAL_OFFER })
      expect(issuerService.createOffer).toHaveBeenCalledWith({
        jsonSchemaCredentialId: 'employee',
        claims: { name: 'Ada Lovelace', role: 'engineer' },
        ttlSeconds: 3600,
        statusListId: undefined,
        statusListIndex: undefined,
      })
    })

    it('maps an unknown type to UNKNOWN_ID and a claim error to INVALID_INPUT', async () => {
      issuerService.createOffer.mockRejectedValueOnce(
        new UnknownCredentialConfigurationError("unknown credential type 'x'"),
      )
      const unknown = await request(app.getHttpServer())
        .post('/v2/openid4vc/credential-offer')
        .send({ jsonSchemaCredentialId: 'x', claims: { name: 'Ada' }, ttlSeconds: 3600 })
      expect(unknown.status).toBe(404)
      expect(unknown.body.error).toEqual({
        code: 'UNKNOWN_ID',
        message: "unknown credential type 'x'",
      })

      issuerService.createOffer.mockRejectedValueOnce(new OpenId4VcIssuerRequestError("unknown claim 'age'"))
      const badClaims = await request(app.getHttpServer())
        .post('/v2/openid4vc/credential-offer')
        .send({ jsonSchemaCredentialId: 'employee', claims: { age: 3 }, ttlSeconds: 3600 })
      expect(badClaims.status).toBe(400)
      expect(badClaims.body.error).toEqual({ code: 'INVALID_INPUT', message: "unknown claim 'age'" })
    })

    it('maps an unknown status list to UNKNOWN_ID', async () => {
      issuerService.createOffer.mockRejectedValueOnce(new UnknownStatusListError("unknown status list 'x'"))

      const response = await request(app.getHttpServer())
        .post('/v2/openid4vc/credential-offer')
        .send({
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada' },
          ttlSeconds: 3600,
          statusListId: 'x',
          statusListIndex: 0,
        })

      expect(response.status).toBe(404)
      expect(response.body.error).toEqual({ code: 'UNKNOWN_ID', message: "unknown status list 'x'" })
    })

    it('validates the offer body and refuses fields the specification does not define', async () => {
      const missing = await validate(
        plainToInstance(Openid4vcCredentialOfferBodyDto, { jsonSchemaCredentialId: 'employee' }),
      )
      expect(missing.map(error => error.property)).toEqual(['claims', 'ttlSeconds'])

      const outOfRange = await validate(
        plainToInstance(Openid4vcCredentialOfferBodyDto, {
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada' },
          ttlSeconds: 5,
        }),
      )
      expect(outOfRange.map(error => error.property)).toEqual(['ttlSeconds'])

      const statusList = await validate(
        plainToInstance(Openid4vcCredentialOfferBodyDto, {
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada' },
          ttlSeconds: 3600,
          statusListId: 'list-1',
          statusListIndex: 0,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
      expect(statusList).toEqual([])

      const extra = await validate(
        plainToInstance(Openid4vcCredentialOfferBodyDto, {
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada' },
          ttlSeconds: 3600,
          revocable: true,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
      expect(extra.map(error => error.property)).toEqual(['revocable'])
    })

    it('refuses half a status list pair at the service, which the controller maps to INVALID_INPUT', async () => {
      issuerService.createOffer.mockRejectedValueOnce(
        new OpenId4VcIssuerRequestError(
          'statusListId and statusListIndex must be both present or both absent',
        ),
      )

      const response = await request(app.getHttpServer())
        .post('/v2/openid4vc/credential-offer')
        .send({
          jsonSchemaCredentialId: 'employee',
          claims: { name: 'Ada' },
          ttlSeconds: 3600,
          statusListIndex: 0,
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_INPUT')
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

  describe('presentations', () => {
    it('walks the presentations with the keyset cursor and ends with a null cursor', async () => {
      const first = await request(app.getHttpServer()).get('/v2/openid4vc/presentations?limit=2')

      expect(first.status).toBe(200)
      expect(proofIds(first.body)).toEqual(['pe-a', 'pe-b'])
      expect(first.body.nextCursor).not.toBeNull()

      const second = await request(app.getHttpServer()).get(
        `/v2/openid4vc/presentations?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )

      expect(second.status).toBe(200)
      expect(proofIds(second.body)).toEqual(['pe-c'])
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
          'jsonSchemaCredentialId',
          'proofExchangeId',
          'requestedClaims',
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
      verifierService.getVerificationSession.mockResolvedValue(verificationSessions[0])

      const response = await request(app.getHttpServer()).get('/v2/openid4vc/presentations/pe-a')

      expect(response.status).toBe(200)
      expect(response.body).not.toHaveProperty('trust')
      expect(response.body).not.toHaveProperty('credential')
      expect(response.body).toMatchObject({
        proofExchangeId: 'pe-a',
        state: 'RequestCreated',
        accepted: false,
      })
    })

    it('filters by credential type and by state', async () => {
      const byType = await request(app.getHttpServer()).get(
        '/v2/openid4vc/presentations?jsonSchemaCredentialId=badge',
      )
      expect(proofIds(byType.body)).toEqual(['pe-c'])

      const byState = await request(app.getHttpServer()).get(
        '/v2/openid4vc/presentations?state=ResponseVerified',
      )
      expect(proofIds(byState.body)).toEqual(['pe-b'])
    })

    it('refuses an unknown state filter', async () => {
      const errors = await validate(plainToInstance(Openid4vcListPresentationsQueryDto, { state: 'Done' }))
      expect(errors.map(error => error.property)).toEqual(['state'])
    })

    it('creates a presentation request with the optional claims, query language and signer', async () => {
      const full = await request(app.getHttpServer())
        .post('/v2/openid4vc/presentation-request')
        .send({
          jsonSchemaCredentialId: 'employee',
          requestedClaims: ['name'],
          queryLanguage: 'presentation_exchange',
          requestSigner: 'x5c',
        })

      expect(full.status).toBe(201)
      expect(full.body).toEqual({ proofExchangeId: 'pe-new', url: AUTHORIZATION_REQUEST })
      expect(verifierService.createRequest).toHaveBeenCalledWith({
        jsonSchemaCredentialId: 'employee',
        requestedClaims: ['name'],
        queryLanguage: 'presentation_exchange',
        requestSigner: 'x5c',
      })

      const bare = await request(app.getHttpServer())
        .post('/v2/openid4vc/presentation-request')
        .send({ jsonSchemaCredentialId: 'employee' })

      expect(bare.status).toBe(201)
      expect(verifierService.createRequest).toHaveBeenLastCalledWith({
        jsonSchemaCredentialId: 'employee',
        requestedClaims: undefined,
        queryLanguage: undefined,
        requestSigner: undefined,
      })
    })

    it('maps an unknown type to UNKNOWN_ID and a signer problem to INVALID_STATE', async () => {
      verifierService.createRequest.mockRejectedValueOnce(
        new UnknownCredentialConfigurationError("unknown credential type 'x'"),
      )
      const unknown = await request(app.getHttpServer())
        .post('/v2/openid4vc/presentation-request')
        .send({ jsonSchemaCredentialId: 'x' })
      expect(unknown.status).toBe(404)
      expect(unknown.body.error).toEqual({ code: 'UNKNOWN_ID', message: "unknown credential type 'x'" })

      verifierService.createRequest.mockRejectedValueOnce(
        new OpenId4VcVerifierRequestError(
          'verifier is configured to sign requests with its DID, but the DID does not publish the signing key for authentication',
        ),
      )
      const unsigned = await request(app.getHttpServer())
        .post('/v2/openid4vc/presentation-request')
        .send({ jsonSchemaCredentialId: 'employee', requestSigner: 'did' })
      expect(unsigned.status).toBe(409)
      expect(unsigned.body.error.code).toBe('INVALID_STATE')
    })

    it('maps a rejected requestedClaims to INVALID_INPUT', async () => {
      verifierService.createRequest.mockRejectedValueOnce(
        new InvalidPresentationRequestError("unknown claim 'admin'"),
      )

      const response = await request(app.getHttpServer())
        .post('/v2/openid4vc/presentation-request')
        .send({ jsonSchemaCredentialId: 'employee', requestedClaims: ['admin'] })

      expect(response.status).toBe(400)
      expect(response.body.error).toEqual({ code: 'INVALID_INPUT', message: "unknown claim 'admin'" })
    })

    it('validates the request body and refuses fields the specification does not define', async () => {
      const badLanguage = await validate(
        plainToInstance(Openid4vcPresentationRequestBodyDto, {
          jsonSchemaCredentialId: 'employee',
          queryLanguage: 'sql',
        }),
      )
      expect(badLanguage.map(error => error.property)).toEqual(['queryLanguage'])

      const duplicateClaims = await validate(
        plainToInstance(Openid4vcPresentationRequestBodyDto, {
          jsonSchemaCredentialId: 'employee',
          requestedClaims: ['name', 'name'],
        }),
      )
      expect(duplicateClaims.map(error => error.property)).toEqual(['requestedClaims'])

      const extra = await validate(
        plainToInstance(Openid4vcPresentationRequestBodyDto, {
          jsonSchemaCredentialId: 'employee',
          responseMode: 'direct_post',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
      expect(extra.map(error => error.property)).toEqual(['responseMode'])

      const empty = await validate(plainToInstance(Openid4vcPresentationRequestBodyDto, {}))
      expect(empty.map(error => error.property)).toEqual(['jsonSchemaCredentialId'])
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

  describe('signing certificates', () => {
    it('returns one record per capability, issuer first, as a bare array', async () => {
      const response = await request(app.getHttpServer()).get('/v2/openid4vc/signing-certificates')

      expect(response.status).toBe(200)
      expect(response.body).toEqual([issuerCertificate, verifierCertificate])
      expect(issuerService.ensureInitialized).toHaveBeenCalledOnce()
      expect(verifierService.ensureInitialized).toHaveBeenCalledOnce()
    })

    it('ignores pagination parameters on this bounded collection', async () => {
      const response = await request(app.getHttpServer()).get(
        '/v2/openid4vc/signing-certificates?limit=1&cursor=abc',
      )

      expect(response.status).toBe(200)
      expect(response.body).toHaveLength(2)
    })

    it('never includes a private key', async () => {
      const response = await request(app.getHttpServer()).get('/v2/openid4vc/signing-certificates')

      expect(JSON.stringify(response.body)).not.toContain('"d":')
      expect(Object.keys(response.body[0]).sort()).toEqual([
        'certificateChain',
        'development',
        'fingerprint',
        'role',
      ])
    })
  })
})
