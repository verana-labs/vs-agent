import type { INestApplication } from '@nestjs/common'

import { RecordNotFoundError } from '@credo-ts/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above these imports, so the controller and this file share the mocked pair.
import { createInvitation, fetchJson } from '@verana-labs/vs-agent-sdk'

import { ErrorEnvelopeFilter } from '../src/common'
import { CredentialTypesService } from '../src/controllers/admin/credentials'
import { V2DidcommPresentationsController } from '../src/controllers/admin/v2/didcomm/V2DidcommPresentationsController'
import { CreatePresentationRequestBodyDto } from '../src/controllers/admin/v2/didcomm/dto'
import { UrlShorteningService } from '../src/services/UrlShorteningService'
import { VsAgentService } from '../src/services/VsAgentService'

vi.mock('@verana-labs/vs-agent-sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('@verana-labs/vs-agent-sdk')>()),
  createInvitation: vi.fn(),
  fetchJson: vi.fn(),
}))

// A metadata bag that reads back what the controller wrote, so a record round-trips like a real one.
const metadata = (initial: Record<string, unknown> = {}) => {
  const store = new Map(Object.entries(initial))
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: unknown) => store.set(key, value),
  }
}

const proofRecord = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => {
  const record = {
    id,
    state: 'request-sent',
    role: 'verifier',
    connectionId: `conn-${id}`,
    errorMessage: undefined,
    threadId: `thread-${id}`,
    isVerified: undefined,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    metadata: metadata({ '_2060/requestedCredentials': [{ credentialDefinitionId: 'cred-def-1' }] }),
    clone: () => record,
    ...extra,
  }
  return record
}

const proofs = {
  createRequest: vi.fn(),
  update: vi.fn(),
  getAll: vi.fn(),
  declineRequest: vi.fn(),
  sendProblemReport: vi.fn(),
  findById: vi.fn(),
  deleteById: vi.fn(),
  getFormatData: vi.fn(),
  getCredentialsForRequest: vi.fn(),
  acceptRequest: vi.fn(),
  acceptPresentation: vi.fn(),
}

// The matches that `getCredentialsForRequest` returns for a request of one attribute group.
const matchingCredentials = {
  attributes: { 'gov-id': [{ credentialId: 'cred-1' }] },
  predicates: {},
}
const anoncreds = { getCredentialDefinition: vi.fn(), getSchema: vi.fn() }

const events = { emit: vi.fn() }

const vsAgentService = {
  getAgent: vi.fn().mockResolvedValue({ didcomm: { proofs }, modules: { anoncreds }, events, context: {} }),
}
const urlShortenerService = { createShortUrl: vi.fn() }
const credentialTypesService = { findAnonCredsSchema: vi.fn() }

const govId = { name: 'gov-id', attrNames: ['firstName', 'lastName'] }

const requestedAttributesOf = () => proofs.createRequest.mock.calls[0][0].proofFormats.anoncreds

describe('v2 didcomm presentation routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommPresentationsController],
      providers: [
        { provide: VsAgentService, useValue: vsAgentService },
        { provide: UrlShorteningService, useValue: urlShortenerService },
        { provide: CredentialTypesService, useValue: credentialTypesService },
        { provide: 'PUBLIC_API_BASE_URL', useValue: 'https://agent.test' },
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
    proofs.createRequest.mockResolvedValue({
      proofRecord: { id: 'proof-1', metadata: metadata() },
      message: { id: 'msg-1' },
    })
    proofs.getFormatData.mockResolvedValue({})
    anoncreds.getCredentialDefinition.mockResolvedValue({ credentialDefinition: { schemaId: 'schema-1' } })
    anoncreds.getSchema.mockResolvedValue({ schema: govId })
    vi.mocked(createInvitation).mockResolvedValue({ url: 'didcomm://agent.test/inv' })
    urlShortenerService.createShortUrl.mockResolvedValue('abcd')
  })

  describe('createPresentationRequest', () => {
    it('builds one attribute group per requested credential, disambiguating a shared schema name', async () => {
      anoncreds.getCredentialDefinition
        .mockResolvedValueOnce({ credentialDefinition: { schemaId: 'schema-1' } })
        .mockResolvedValueOnce({ credentialDefinition: { schemaId: 'schema-2' } })
      anoncreds.getSchema
        .mockResolvedValueOnce({ schema: govId })
        .mockResolvedValueOnce({ schema: { name: 'gov-id', attrNames: ['documentNumber'] } })

      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({
          requestedCredentials: [
            { credentialDefinitionId: 'cred-def-1', attributes: ['firstName'] },
            { credentialDefinitionId: 'cred-def-2', attributes: ['documentNumber'] },
          ],
        })

      expect(response.status).toBe(201)
      expect(requestedAttributesOf().requested_attributes).toEqual({
        'gov-id': { names: ['firstName'], restrictions: [{ cred_def_id: 'cred-def-1' }] },
        'gov-id-2': { names: ['documentNumber'], restrictions: [{ cred_def_id: 'cred-def-2' }] },
      })
    })

    it('asks for every attribute of the schema when the entry omits them', async () => {
      await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [{ credentialDefinitionId: 'cred-def-1' }] })

      expect(requestedAttributesOf().requested_attributes['gov-id'].names).toEqual(['firstName', 'lastName'])
    })

    it('resolves a jsonSchemaCredentialId through the issuer of the fetched credential', async () => {
      vi.mocked(fetchJson).mockResolvedValue({ issuer: 'did:web:issuer.test' })
      credentialTypesService.findAnonCredsSchema.mockResolvedValue({ schema: govId, schemaId: 'schema-9' })

      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [{ jsonSchemaCredentialId: 'https://issuer.test/jsc.json' }] })

      expect(response.status).toBe(201)
      expect(credentialTypesService.findAnonCredsSchema).toHaveBeenCalledWith({
        relatedJsonSchemaCredentialId: 'https://issuer.test/jsc.json',
        issuerDid: 'did:web:issuer.test',
      })
      expect(requestedAttributesOf().requested_attributes['gov-id'].restrictions).toEqual([
        { schema_id: 'schema-9' },
      ])
    })

    it('reports an attribute absent from the schema as INVALID_INPUT rather than a failure', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [{ credentialDefinitionId: 'cred-def-1', attributes: ['ssn'] }] })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_INPUT')
      expect(proofs.createRequest).not.toHaveBeenCalled()
    })

    it.each([
      ['both identifiers', { credentialDefinitionId: 'cred-def-1', jsonSchemaCredentialId: 'https://a/b' }],
      ['neither identifier', { attributes: ['firstName'] }],
    ])('refuses an entry naming %s', async (_label, entry) => {
      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [entry] })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_INPUT')
    })

    it('refuses a request that names no credential at all', async () => {
      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [] })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('INVALID_INPUT')
    })

    it('refuses the removed callbackUrl and ref fields', async () => {
      const errors = await validate(
        plainToInstance(CreatePresentationRequestBodyDto, {
          requestedCredentials: [{ credentialDefinitionId: 'cred-def-1' }],
          callbackUrl: 'https://cb.test/done',
          ref: '1234',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )

      expect(errors.map(error => error.property).sort()).toEqual(['callbackUrl', 'ref'])
    })

    it('carries the requested credentials onto the record and the envelope choice onto the invitation', async () => {
      const proofRecordSpy = { id: 'proof-1', metadata: metadata() }
      proofs.createRequest.mockResolvedValue({ proofRecord: proofRecordSpy, message: { id: 'msg-1' } })

      const requestedCredentials = [{ credentialDefinitionId: 'cred-def-1', attributes: ['firstName'] }]
      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentation-request').send({
        requestedCredentials,
        didcommVersion: 'v1',
      })

      expect(response.body).toEqual({
        proofExchangeId: 'proof-1',
        url: 'didcomm://agent.test/inv',
        shortUrl: 'https://agent.test/s?id=abcd',
      })
      expect(proofRecordSpy.metadata.get('_2060/requestedCredentials')).toEqual(requestedCredentials)
      expect(proofs.update).toHaveBeenCalledWith(proofRecordSpy)
      // The spec spells the field `didcommVersion`; the SDK takes `didCommVersion`.
      expect(vi.mocked(createInvitation).mock.calls[0][0]).toMatchObject({ didCommVersion: 'v1' })
      expect(urlShortenerService.createShortUrl).toHaveBeenCalledWith({
        longUrl: 'didcomm://agent.test/inv',
        relatedFlowId: 'proof-1',
      })
    })

    it('asks for a non-revocation interval only when requireNonRevocation is set', async () => {
      const body = { requestedCredentials: [{ credentialDefinitionId: 'cred-def-1' }] }

      await request(app.getHttpServer()).post('/v2/didcomm/presentation-request').send(body)
      expect(requestedAttributesOf().non_revoked).toBeUndefined()

      proofs.createRequest.mockClear()
      await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ ...body, requireNonRevocation: true })

      const { non_revoked: nonRevoked } = requestedAttributesOf()
      expect(nonRevoked.from).toEqual(nonRevoked.to)
      expect(nonRevoked.from).toBeTypeOf('number')
    })
  })

  describe('listPresentations, getPresentation and deletePresentation', () => {
    // Deliberately out of order: the controller owes a deterministic order of its own.
    const records = [
      proofRecord('p-2', '2026-01-02T00:00:00.000Z'),
      proofRecord('p-3', '2026-01-03T00:00:00.000Z'),
      proofRecord('p-1', '2026-01-01T00:00:00.000Z'),
    ]

    beforeEach(() => {
      proofs.getAll.mockResolvedValue(records)
    })

    it('walks the presentations with the keyset cursor and ends with a null cursor', async () => {
      const first = await request(app.getHttpServer()).get('/v2/didcomm/presentations?limit=2')

      expect(first.status).toBe(200)
      expect(first.body.items.map((item: { proofExchangeId: string }) => item.proofExchangeId)).toEqual([
        'p-1',
        'p-2',
      ])
      expect(first.body.nextCursor).not.toBeNull()

      const second = await request(app.getHttpServer()).get(
        `/v2/didcomm/presentations?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )

      expect(second.body.items.map((item: { proofExchangeId: string }) => item.proofExchangeId)).toEqual([
        'p-3',
      ])
      expect(second.body.nextCursor).toBeNull()
    })

    it('flattens the revealed attributes and the revealed attribute groups into one claim list', async () => {
      proofs.findById.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'done', isVerified: true }),
      )
      proofs.getFormatData.mockResolvedValue({
        presentation: {
          anoncreds: {
            requested_proof: {
              revealed_attrs: { firstName: { raw: 'Alice' } },
              revealed_attr_groups: { 'gov-id': { values: { lastName: { raw: 'Smith' } } } },
            },
          },
        },
      })

      const response = await request(app.getHttpServer()).get('/v2/didcomm/presentations/p-1')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        proofExchangeId: 'p-1',
        state: 'done',
        role: 'verifier',
        connectionId: 'conn-p-1',
        verified: true,
        threadId: 'thread-p-1',
        requestedCredentials: [{ credentialDefinitionId: 'cred-def-1' }],
        claims: [
          { name: 'firstName', value: 'Alice' },
          { name: 'lastName', value: 'Smith' },
        ],
      })
    })

    it('reports an unknown presentation as UNKNOWN_ID', async () => {
      proofs.findById.mockResolvedValue(null)

      const response = await request(app.getHttpServer()).get('/v2/didcomm/presentations/nope')

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('UNKNOWN_ID')
    })

    it('deletes a presentation with its DIDComm messages and answers 204', async () => {
      proofs.deleteById.mockResolvedValue(undefined)

      const response = await request(app.getHttpServer()).delete('/v2/didcomm/presentations/p-1')

      expect(response.status).toBe(204)
      expect(response.body).toEqual({})
      expect(proofs.deleteById).toHaveBeenCalledWith('p-1', { deleteAssociatedDidCommMessages: true })
    })

    it('reports a delete of an unknown presentation as UNKNOWN_ID', async () => {
      proofs.deleteById.mockRejectedValue(new RecordNotFoundError('not found', { recordType: 'x' }))

      const response = await request(app.getHttpServer()).delete('/v2/didcomm/presentations/nope')

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('UNKNOWN_ID')
    })

    it('does not collapse an unexpected storage failure into UNKNOWN_ID', async () => {
      proofs.deleteById.mockRejectedValue(new Error('askar rejected the write'))

      const response = await request(app.getHttpServer()).delete('/v2/didcomm/presentations/p-1')

      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe('INTERNAL')
    })
  })
  describe('declinePresentationExchange', () => {
    beforeEach(() => {
      proofs.getFormatData.mockResolvedValue({})
    })

    it('lets Credo decline the request the agent received, with the reason of the caller', async () => {
      proofs.findById.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'request-received' }),
      )
      proofs.declineRequest.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'declined' }),
      )

      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentations/p-1/decline')
        .send({ reason: 'the holder refused' })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ proofExchangeId: 'p-1', state: 'declined' })
      expect(proofs.declineRequest).toHaveBeenCalledWith({
        proofExchangeRecordId: 'p-1',
        sendProblemReport: true,
        problemReportDescription: 'the holder refused',
      })
      expect(proofs.sendProblemReport).not.toHaveBeenCalled()
    })

    it('declines the verifier step with a problem report, and emits the state change', async () => {
      const record = proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'presentation-received' })
      proofs.findById.mockResolvedValue(record)

      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentations/p-1/decline')
        .send({})

      expect(response.status).toBe(200)
      expect(response.body.state).toBe('declined')
      expect(response.body.errorMessage).toBeUndefined()
      expect(proofs.sendProblemReport).toHaveBeenCalledWith({
        proofExchangeRecordId: 'p-1',
        description: 'Request declined',
      })
      expect(proofs.update).toHaveBeenCalledWith(record)
      expect(events.emit).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          payload: { proofRecord: record, previousState: 'presentation-received' },
        }),
      )
    })

    it('still declines when the agent cannot notify the peer, and keeps the reason on the record', async () => {
      proofs.findById.mockResolvedValue(proofRecord('p-1', '2026-01-01T00:00:00.000Z'))
      proofs.sendProblemReport.mockRejectedValue(new Error('no connection for the exchange'))

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/decline')

      expect(response.status).toBe(200)
      expect(response.body.state).toBe('declined')
      expect(response.body.errorMessage).toContain('could not notify the peer')
      expect(proofs.update).toHaveBeenCalled()
    })

    it('answers INVALID_STATE for a decline of a terminal exchange', async () => {
      proofs.findById.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'abandoned' }),
      )

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/decline')

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('INVALID_STATE')
      expect(proofs.update).not.toHaveBeenCalled()
    })

    it('reports a decline of an unknown presentation as UNKNOWN_ID', async () => {
      proofs.findById.mockResolvedValue(null)

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/nope/decline')

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('UNKNOWN_ID')
    })
  })

  describe('autoAccept', () => {
    it('stops the agent from acknowledging a presentation on its own by default', async () => {
      await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [{ credentialDefinitionId: 'cred-def-1' }] })

      expect(proofs.createRequest.mock.calls[0][0].autoAcceptProof).toBe('never')
    })

    it('lets the agent complete its verifier steps when the caller asks for it', async () => {
      await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({ requestedCredentials: [{ credentialDefinitionId: 'cred-def-1' }], autoAccept: true })

      expect(proofs.createRequest.mock.calls[0][0].autoAcceptProof).toBe('contentApproved')
    })
  })

  describe('acceptPresentationRequest', () => {
    beforeEach(() => {
      proofs.findById.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'request-received' }),
      )
      proofs.getCredentialsForRequest.mockResolvedValue({
        proofFormats: { anoncreds: matchingCredentials },
      })
      proofs.acceptRequest.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'presentation-sent' }),
      )
      proofs.getFormatData.mockResolvedValue({})
    })

    it('lets the agent select the credentials and answers with the updated record', async () => {
      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/accept-request')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ proofExchangeId: 'p-1', state: 'presentation-sent' })
      expect(proofs.acceptRequest).toHaveBeenCalledWith({ proofExchangeRecordId: 'p-1' })
    })

    it('rejects a state other than request-received with INVALID_STATE', async () => {
      proofs.findById.mockResolvedValue(proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'done' }))

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/accept-request')

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('INVALID_STATE')
      expect(proofs.acceptRequest).not.toHaveBeenCalled()
    })

    it('rejects a group that no credential matches with NO_COMPATIBLE_CREDENTIALS', async () => {
      proofs.getCredentialsForRequest.mockResolvedValue({
        proofFormats: { anoncreds: { attributes: { 'gov-id': [] }, predicates: {} } },
      })

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/accept-request')

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('NO_COMPATIBLE_CREDENTIALS')
      expect(response.body.error.message).toContain('gov-id')
      expect(proofs.acceptRequest).not.toHaveBeenCalled()
    })

    it('rejects a request of a format the agent cannot present with NO_COMPATIBLE_CREDENTIALS', async () => {
      proofs.getCredentialsForRequest.mockResolvedValue({ proofFormats: {} })

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/accept-request')

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('NO_COMPATIBLE_CREDENTIALS')
      expect(proofs.acceptRequest).not.toHaveBeenCalled()
    })

    it('answers a legacy indy request from the indy matches', async () => {
      proofs.getCredentialsForRequest.mockResolvedValue({ proofFormats: { indy: matchingCredentials } })

      const response = await request(app.getHttpServer()).post('/v2/didcomm/presentations/p-1/accept-request')

      expect(response.status).toBe(200)
      expect(proofs.acceptRequest).toHaveBeenCalledWith({ proofExchangeRecordId: 'p-1' })
    })

    it('reports an unknown presentation as UNKNOWN_ID', async () => {
      proofs.findById.mockResolvedValue(null)

      const response = await request(app.getHttpServer()).post(
        '/v2/didcomm/presentations/nope/accept-request',
      )

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('UNKNOWN_ID')
    })
  })

  describe('acceptPresentation', () => {
    beforeEach(() => {
      proofs.findById.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'presentation-received' }),
      )
      proofs.acceptPresentation.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'done', isVerified: true }),
      )
      proofs.getFormatData.mockResolvedValue({})
    })

    it('acknowledges the presentation and answers with the record in state done', async () => {
      const response = await request(app.getHttpServer()).post(
        '/v2/didcomm/presentations/p-1/accept-presentation',
      )

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ proofExchangeId: 'p-1', state: 'done', verified: true })
      expect(proofs.acceptPresentation).toHaveBeenCalledWith({ proofExchangeRecordId: 'p-1' })
    })

    it('rejects a state other than presentation-received with INVALID_STATE', async () => {
      proofs.findById.mockResolvedValue(
        proofRecord('p-1', '2026-01-01T00:00:00.000Z', { state: 'request-sent' }),
      )

      const response = await request(app.getHttpServer()).post(
        '/v2/didcomm/presentations/p-1/accept-presentation',
      )

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('INVALID_STATE')
      expect(proofs.acceptPresentation).not.toHaveBeenCalled()
    })

    it('reports an unknown presentation as UNKNOWN_ID', async () => {
      proofs.findById.mockResolvedValue(null)

      const response = await request(app.getHttpServer()).post(
        '/v2/didcomm/presentations/nope/accept-presentation',
      )

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('UNKNOWN_ID')
    })
  })
})
