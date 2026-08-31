import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { createInvitation } from '@verana-labs/vs-agent-sdk'

import { ErrorEnvelopeFilter } from '../src/common'
import { CreateCredentialOfferBodyDto } from '../src/controllers/admin/v2/didcomm/dto'
import { V2DidcommCredentialExchangesController } from '../src/controllers/admin/v2/didcomm/V2DidcommCredentialExchangesController'
import { UrlShorteningService } from '../src/services/UrlShorteningService'
import { VsAgentService } from '../src/services/VsAgentService'

vi.mock('@verana-labs/vs-agent-sdk', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, createInvitation: vi.fn() }
})

const schema = { name: 'phoneNumber', version: '1.0', attrNames: ['phoneNumber', 'issuedAt'] }

function exchangeRecord(options: {
  id: string
  createdAt: string
  credentialDefinitionId?: string
  schemaId?: string
}) {
  const metadata: Record<string, unknown> = {}
  if (options.credentialDefinitionId || options.schemaId) {
    metadata[AnonCredsCredentialMetadataKey] = {
      credentialDefinitionId: options.credentialDefinitionId,
      schemaId: options.schemaId,
    }
  }

  return {
    id: options.id,
    state: 'offer-sent',
    threadId: `thread-${options.id}`,
    connectionId: `conn-${options.id}`,
    errorMessage: undefined,
    createdAt: new Date(options.createdAt),
    updatedAt: undefined,
    metadata: {
      get: (key: string) => metadata[key],
    },
  }
}

const records = [
  exchangeRecord({
    id: 'ce-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    credentialDefinitionId: 'credDef:a',
    schemaId: 'schema:phone',
  }),
  exchangeRecord({
    id: 'ce-b',
    createdAt: '2026-01-02T00:00:00.000Z',
    credentialDefinitionId: 'credDef:a',
    schemaId: 'schema:phone',
  }),
  exchangeRecord({ id: 'ce-c', createdAt: '2026-01-03T00:00:00.000Z' }),
]

const agent = {
  modules: {
    anoncreds: {
      getCreatedCredentialDefinitions: vi.fn(),
      getSchema: vi.fn().mockResolvedValue({ schema }),
    },
  },
  didcomm: {
    credentials: {
      createOffer: vi.fn(),
      getAll: vi.fn().mockResolvedValue(records),
      findById: vi.fn(),
      getFormatData: vi.fn(),
    },
  },
}

const vsAgentService = { getAgent: vi.fn().mockResolvedValue(agent) }
const urlShorteningService = { createShortUrl: vi.fn().mockResolvedValue('short-1') }

function credentialDefinition(revocable: boolean) {
  return {
    credentialDefinitionId: 'credDef:a',
    credentialDefinition: { schemaId: 'schema:phone', value: revocable ? { revocation: {} } : {} },
  }
}

describe('v2 didcomm credential exchange routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommCredentialExchangesController],
      providers: [
        { provide: VsAgentService, useValue: vsAgentService },
        { provide: UrlShorteningService, useValue: urlShorteningService },
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
    agent.didcomm.credentials.getAll.mockResolvedValue(records)
    agent.didcomm.credentials.getFormatData.mockResolvedValue({
      offerAttributes: [{ name: 'phoneNumber', value: '+57128348520' }],
    })
    agent.modules.anoncreds.getSchema.mockResolvedValue({ schema })
    agent.modules.anoncreds.getCreatedCredentialDefinitions.mockResolvedValue([credentialDefinition(false)])
    urlShorteningService.createShortUrl.mockResolvedValue('short-1')
    vi.mocked(createInvitation).mockResolvedValue({ url: 'didcomm://agent.test/invite' } as never)
  })

  it('walks the credential exchanges with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges?limit=2')

    expect(first.status).toBe(200)
    expect(
      first.body.items.map((item: { credentialExchangeId: string }) => item.credentialExchangeId),
    ).toEqual(['ce-a', 'ce-b'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/didcomm/credential-exchanges?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(
      second.body.items.map((item: { credentialExchangeId: string }) => item.credentialExchangeId),
    ).toEqual(['ce-c'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('sends every field that the specification names in the record', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges?limit=1')

    expect(Object.keys(response.body.items[0]).sort()).toEqual(
      [
        'claims',
        'connectionId',
        'createdAt',
        'credentialDefinitionId',
        'credentialExchangeId',
        'schemaId',
        'state',
        'threadId',
        'updatedAt',
      ].sort(),
    )
    expect(response.body.items[0].claims).toEqual([{ name: 'phoneNumber', value: '+57128348520' }])
    expect(response.body.items[0].credentialDefinitionId).toBe('credDef:a')
    expect(response.body.items[0].schemaId).toBe('schema:phone')
    // This record has no updatedAt value. The agent sends the createdAt value.
    expect(response.body.items[0].updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps the page if the agent cannot read the offer of one record', async () => {
    agent.didcomm.credentials.getFormatData.mockRejectedValue(new Error('no format data'))

    const response = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges')

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(3)
    expect(response.body.items[0].claims).toEqual([])
  })

  it('rejects a malformed cursor with the INVALID_CURSOR envelope', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges?cursor=%25%25')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_CURSOR')
  })

  it('gets one credential exchange by identifier', async () => {
    agent.didcomm.credentials.findById.mockResolvedValue(records[1])

    const response = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges/ce-b')

    expect(response.status).toBe(200)
    expect(response.body.credentialExchangeId).toBe('ce-b')
    expect(response.body.credentialDefinitionId).toBe('credDef:a')
    expect(response.body.schemaId).toBe('schema:phone')
    expect(agent.didcomm.credentials.findById).toHaveBeenCalledWith('ce-b')
  })

  it('leaves out the AnonCreds identifiers of a record without AnonCreds metadata', async () => {
    agent.didcomm.credentials.findById.mockResolvedValue(records[2])

    const response = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges/ce-c')

    expect(response.status).toBe(200)
    expect(response.body.credentialDefinitionId).toBeUndefined()
    expect(response.body.schemaId).toBeUndefined()
  })

  it('answers UNKNOWN_ID for an unknown credential exchange', async () => {
    agent.didcomm.credentials.findById.mockResolvedValue(null)

    const response = await request(app.getHttpServer()).get('/v2/didcomm/credential-exchanges/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('creates a credential offer and sends the invitation URLs', async () => {
    agent.didcomm.credentials.createOffer.mockResolvedValue({
      message: { id: 'msg-1' },
      credentialExchangeRecord: { id: 'ce-new' },
    })

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
      })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      credentialExchangeId: 'ce-new',
      url: 'didcomm://agent.test/invite',
      shortUrl: 'https://agent.test/s?id=short-1',
    })
  })

  it('passes didcommVersion through to the invitation, and omits it when the caller does', async () => {
    agent.didcomm.credentials.createOffer.mockResolvedValue({
      message: { id: 'msg-1' },
      credentialExchangeRecord: { id: 'ce-new' },
    })

    await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
        didcommVersion: 'v1',
        useLegacyDid: true,
      })

    expect(vi.mocked(createInvitation).mock.calls[0][0]).toMatchObject({
      didCommVersion: 'v1',
      useLegacyDid: true,
    })

    await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
      })

    // The specification tells the agent to use v2 if the caller sends no value. The SDK does this.
    expect(vi.mocked(createInvitation).mock.calls[1][0].didCommVersion).toBeUndefined()
  })

  it('answers UNKNOWN_ID for an unknown credential definition', async () => {
    agent.modules.anoncreds.getCreatedCredentialDefinitions.mockResolvedValue([])

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:missing',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
      })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(agent.didcomm.credentials.createOffer).not.toHaveBeenCalled()
  })

  it('refuses a claim that the schema does not define', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'nickname', value: 'Ali' }],
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
    expect(response.body.error.message).toContain('nickname')
    expect(agent.didcomm.credentials.createOffer).not.toHaveBeenCalled()
  })

  it('needs the two revocation fields for a revocable credential definition', async () => {
    agent.modules.anoncreds.getCreatedCredentialDefinitions.mockResolvedValue([credentialDefinition(true)])

    const missing = await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
      })

    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe('INVALID_INPUT')
    expect(agent.didcomm.credentials.createOffer).not.toHaveBeenCalled()

    agent.didcomm.credentials.createOffer.mockResolvedValue({
      message: { id: 'msg-1' },
      credentialExchangeRecord: { id: 'ce-new' },
    })

    const complete = await request(app.getHttpServer())
      .post('/v2/didcomm/credential-offer')
      .send({
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
        revocationRegistryDefinitionId: 'revReg:1',
        revocationRegistryIndex: 1,
      })

    expect(complete.status).toBe(201)
    expect(agent.didcomm.credentials.createOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialFormats: {
          anoncreds: expect.objectContaining({
            revocationRegistryDefinitionId: 'revReg:1',
            revocationRegistryIndex: 1,
          }),
        },
      }),
    )
  })

  // The ValidationPipe reads the DTO type from `design:paramtypes`. The production build writes
  // this data, but the vitest transform does not write it. For this reason, these tests examine
  // the DTO and not the route.
  it('needs credentialDefinitionId and a claim in the offer body', async () => {
    const empty = await validate(plainToInstance(CreateCredentialOfferBodyDto, {}))
    expect(empty.map(error => error.property).sort()).toEqual(['claims', 'credentialDefinitionId'])

    const noClaim = await validate(
      plainToInstance(CreateCredentialOfferBodyDto, { credentialDefinitionId: 'credDef:a', claims: [] }),
    )
    expect(noClaim.map(error => error.property)).toEqual(['claims'])
  })

  it('refuses the v1 spelling didCommVersion', async () => {
    const errors = await validate(
      plainToInstance(CreateCredentialOfferBodyDto, {
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520' }],
        didCommVersion: 'v1',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    )

    expect(errors.map(error => error.property)).toEqual(['didCommVersion'])
  })

  it('accepts the fields that the specification defines', async () => {
    const errors = await validate(
      plainToInstance(CreateCredentialOfferBodyDto, {
        credentialDefinitionId: 'credDef:a',
        claims: [{ name: 'phoneNumber', value: '+57128348520', mimeType: 'text/plain' }],
        revocationRegistryDefinitionId: 'revReg:1',
        revocationRegistryIndex: 1,
        useLegacyDid: true,
        didcommVersion: 'v2',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    )

    expect(errors).toEqual([])
  })
})
