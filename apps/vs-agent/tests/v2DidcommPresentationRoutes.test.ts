import type { INestApplication } from '@nestjs/common'

import { RecordNotFoundError } from '@credo-ts/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above these imports, so the controller and this file share the mocked pair.
import { createInvitation, fetchJson } from '@verana-labs/vs-agent-sdk'

import { ErrorEnvelopeFilter } from '../src/common'
import { CredentialTypesService } from '../src/controllers/admin/credentials'
import { V2DidcommPresentationsController } from '../src/controllers/admin/v2/didcomm/V2DidcommPresentationsController'
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

const proofRecord = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  state: 'request-sent',
  threadId: `thread-${id}`,
  isVerified: undefined,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  metadata: metadata({ '_2060/requestedCredentials': [{ credentialDefinitionId: 'cred-def-1' }] }),
  ...extra,
})

const proofs = {
  createRequest: vi.fn(),
  update: vi.fn(),
  getAll: vi.fn(),
  findById: vi.fn(),
  deleteById: vi.fn(),
  getFormatData: vi.fn(),
}
const anoncreds = { getCredentialDefinition: vi.fn(), getSchema: vi.fn() }

const vsAgentService = {
  getAgent: vi.fn().mockResolvedValue({ didcomm: { proofs }, modules: { anoncreds } }),
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

    it('carries the callback parameters onto the record and the envelope choice onto the invitation', async () => {
      const proofRecordSpy = { id: 'proof-1', metadata: metadata() }
      proofs.createRequest.mockResolvedValue({ proofRecord: proofRecordSpy, message: { id: 'msg-1' } })

      const requestedCredentials = [{ credentialDefinitionId: 'cred-def-1', attributes: ['firstName'] }]
      const response = await request(app.getHttpServer())
        .post('/v2/didcomm/presentation-request')
        .send({
          requestedCredentials,
          ref: '1234',
          callbackUrl: 'https://cb.test/done',
          didcommVersion: 'v1',
        })

      expect(response.body).toEqual({
        proofExchangeId: 'proof-1',
        url: 'didcomm://agent.test/inv',
        shortUrl: 'https://agent.test/s?id=abcd',
      })
      expect(proofRecordSpy.metadata.get('_2060/requestedCredentials')).toEqual(requestedCredentials)
      expect(proofRecordSpy.metadata.get('_2060/callbackParameters')).toEqual({
        ref: '1234',
        callbackUrl: 'https://cb.test/done',
      })
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
})
