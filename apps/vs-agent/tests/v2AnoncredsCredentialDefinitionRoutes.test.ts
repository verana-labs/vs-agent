import type { INestApplication } from '@nestjs/common'

import {
  AnonCredsCredentialDefinitionPrivateRepository,
  AnonCredsCredentialDefinitionRepository,
  AnonCredsKeyCorrectnessProofRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { CredentialTypesService } from '../src/controllers/admin/credentials'
import { CreateCredentialDefinitionDto } from '../src/controllers/admin/v2/anoncreds/dto'
import { V2AnoncredsCredentialDefinitionsController } from '../src/controllers/admin/v2/anoncreds/V2AnoncredsCredentialDefinitionsController'
import { VsAgentService } from '../src/services/VsAgentService'

const schemas: Record<string, { name: string; version: string; attrNames: string[] }> = {
  'schema:phone': { name: 'phoneNumber', version: '1.0', attrNames: ['phoneNumber'] },
  'schema:govid': { name: 'govId', version: '1.0', attrNames: ['firstName', 'lastName'] },
  'schema:email': { name: 'email', version: '1.0', attrNames: ['email'] },
}

function credentialDefinitionRecord(options: {
  id: string
  schemaId: string
  name: string
  relatedJsonSchemaCredentialId?: string
  revocable?: boolean
}) {
  const tags: Record<string, string | undefined> = {
    name: options.name,
    version: '1.0',
    relatedJsonSchemaCredentialId: options.relatedJsonSchemaCredentialId,
  }
  return {
    credentialDefinitionId: options.id,
    credentialDefinition: {
      schemaId: options.schemaId,
      issuerId: 'did:web:agent.test',
      tag: `${options.name}.1.0`,
      value: options.revocable ? { revocation: {} } : {},
    },
    getTag: (key: string) => tags[key],
    setTag: (key: string, value: string) => {
      tags[key] = value
    },
  }
}

const records = [
  credentialDefinitionRecord({
    id: 'credDef:a',
    schemaId: 'schema:phone',
    name: 'phoneNumber',
    relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
  }),
  credentialDefinitionRecord({
    id: 'credDef:b',
    schemaId: 'schema:govid',
    name: 'govId',
    relatedJsonSchemaCredentialId: 'https://tr.test/govid-jsc.json',
    revocable: true,
  }),
  credentialDefinitionRecord({
    id: 'credDef:c',
    schemaId: 'schema:email',
    name: 'email',
    relatedJsonSchemaCredentialId: 'https://tr.test/email-jsc.json',
  }),
]

const credentialDefinitionRepository = {
  findByCredentialDefinitionId: vi.fn(),
  getById: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}
const credentialDefinitionPrivateRepository = {
  findByCredentialDefinitionId: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
}
const keyCorrectnessProofRepository = {
  findByCredentialDefinitionId: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
}
const schemaRepository = {
  findBySchemaId: vi.fn(),
  save: vi.fn(),
}
const revocationDefinitionRepository = {
  findAllByCredentialDefinitionId: vi.fn(),
}

const repositories = new Map<unknown, unknown>([
  [AnonCredsCredentialDefinitionRepository, credentialDefinitionRepository],
  [AnonCredsCredentialDefinitionPrivateRepository, credentialDefinitionPrivateRepository],
  [AnonCredsKeyCorrectnessProofRepository, keyCorrectnessProofRepository],
  [AnonCredsSchemaRepository, schemaRepository],
  [AnonCredsRevocationRegistryDefinitionRepository, revocationDefinitionRepository],
])

const agent = {
  context: {},
  dependencyManager: { resolve: (token: unknown) => repositories.get(token) },
  genericRecords: { findAllByQuery: vi.fn().mockResolvedValue([]), delete: vi.fn() },
  modules: {
    anoncreds: {
      getCreatedCredentialDefinitions: vi.fn().mockResolvedValue(records),
      getSchema: vi.fn(async (schemaId: string) => ({ schema: schemas[schemaId] })),
    },
  },
}

const vsAgentService = { getAgent: vi.fn().mockResolvedValue(agent) }

const credentialTypesService = {
  findAnonCredsCredentialDefinition: vi.fn(),
  parseJsonSchemaCredential: vi.fn(),
  getOrRegisterAnonCredsSchema: vi.fn(),
  registerAnonCredsCredentialDefinition: vi.fn(),
  deleteRevocationRegistry: vi.fn(),
}

describe('v2 anoncreds credential definition routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2AnoncredsCredentialDefinitionsController],
      providers: [
        { provide: VsAgentService, useValue: vsAgentService },
        { provide: CredentialTypesService, useValue: credentialTypesService },
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
    agent.modules.anoncreds.getCreatedCredentialDefinitions.mockResolvedValue(records)
    agent.modules.anoncreds.getSchema.mockImplementation(async (schemaId: string) => ({
      schema: schemas[schemaId],
    }))
    agent.genericRecords.findAllByQuery.mockResolvedValue([])
  })

  it('walks the credential definitions with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/anoncreds/credential-definitions?limit=2')

    expect(first.status).toBe(200)
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual(['credDef:a', 'credDef:b'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/anoncreds/credential-definitions?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual(['credDef:c'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('returns records that carry relatedJsonSchemaCredentialId and supportRevocation', async () => {
    const response = await request(app.getHttpServer()).get('/v2/anoncreds/credential-definitions?limit=2')

    expect(response.body.items[0]).toEqual({
      id: 'credDef:a',
      name: 'phoneNumber',
      version: '1.0',
      attributes: ['phoneNumber'],
      supportRevocation: false,
      relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
    })
    expect(response.body.items[1].supportRevocation).toBe(true)
  })

  it('rejects a malformed cursor with the INVALID_CURSOR envelope', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v2/anoncreds/credential-definitions?cursor=%25%25',
    )

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_CURSOR')
  })

  // The ValidationPipe reads the DTO type from `design:paramtypes`. The production build writes
  // this data, but the vitest transform does not write it. For this reason, these tests examine
  // the DTO and not the route.
  it('rejects a create body that omits relatedJsonSchemaCredentialId', async () => {
    const errors = await validate(plainToInstance(CreateCredentialDefinitionDto, { supportRevocation: true }))

    expect(errors.map(error => error.property)).toEqual(['relatedJsonSchemaCredentialId'])
  })

  it('rejects the v1 creation fields that the v2 input set drops', async () => {
    for (const extra of [
      { name: 'phoneNumber', version: '1.0' },
      { attributes: ['phoneNumber'] },
      { schemaId: 'schema:phone' },
      { issuerDid: 'did:webvh:Qm:issuer.test' },
    ]) {
      const errors = await validate(
        plainToInstance(CreateCredentialDefinitionDto, {
          relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
          ...extra,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )

      expect(errors.map(error => error.property).sort()).toEqual(Object.keys(extra).sort())
    }
  })

  it('accepts the two fields the spec defines', async () => {
    const errors = await validate(
      plainToInstance(CreateCredentialDefinitionDto, {
        relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
        supportRevocation: true,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    )

    expect(errors).toEqual([])
  })

  it('creates a credential definition from the JSON Schema Credential alone', async () => {
    credentialTypesService.findAnonCredsCredentialDefinition.mockResolvedValue(undefined)
    credentialTypesService.parseJsonSchemaCredential.mockResolvedValue({ attrNames: ['phoneNumber'] })
    credentialTypesService.getOrRegisterAnonCredsSchema.mockResolvedValue({
      schemaId: 'schema:phone',
      schema: schemas['schema:phone'],
    })
    credentialTypesService.registerAnonCredsCredentialDefinition.mockResolvedValue({
      credentialDefinitionId: 'credDef:new',
    })

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions')
      .send({ relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json', supportRevocation: true })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      id: 'credDef:new',
      name: 'phoneNumber',
      version: '1.0',
      attributes: ['phoneNumber'],
      supportRevocation: true,
      relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
    })

    // The specification permits only two fields. The agent sends no issuer DID to the schema.
    expect(credentialTypesService.getOrRegisterAnonCredsSchema).toHaveBeenCalledWith({
      relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
    })
  })

  it('defaults supportRevocation to false', async () => {
    credentialTypesService.findAnonCredsCredentialDefinition.mockResolvedValue(undefined)
    credentialTypesService.parseJsonSchemaCredential.mockResolvedValue({ attrNames: ['phoneNumber'] })
    credentialTypesService.getOrRegisterAnonCredsSchema.mockResolvedValue({
      schemaId: 'schema:phone',
      schema: schemas['schema:phone'],
    })
    credentialTypesService.registerAnonCredsCredentialDefinition.mockResolvedValue({
      credentialDefinitionId: 'credDef:new',
    })

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions')
      .send({ relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json' })

    expect(response.body.supportRevocation).toBe(false)
    expect(credentialTypesService.registerAnonCredsCredentialDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ supportRevocation: false }),
    )
  })

  it('answers UNKNOWN_ID when it cannot resolve relatedJsonSchemaCredentialId', async () => {
    credentialTypesService.findAnonCredsCredentialDefinition.mockResolvedValue(undefined)
    credentialTypesService.parseJsonSchemaCredential.mockRejectedValue(new Error('fetch failed'))

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions')
      .send({ relatedJsonSchemaCredentialId: 'https://tr.test/missing-jsc.json' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(credentialTypesService.registerAnonCredsCredentialDefinition).not.toHaveBeenCalled()
  })

  it('refuses a second definition for the same JSON Schema Credential', async () => {
    credentialTypesService.findAnonCredsCredentialDefinition.mockResolvedValue(records[0])

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions')
      .send({ relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('INVALID_STATE')
  })

  it('exports a package whose data carries the governing JSON Schema Credential', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(records[0])
    credentialDefinitionPrivateRepository.findByCredentialDefinitionId.mockResolvedValue({
      value: { private: true },
    })
    keyCorrectnessProofRepository.findByCredentialDefinitionId.mockResolvedValue({ value: { kcp: true } })
    schemaRepository.findBySchemaId.mockResolvedValue({ schema: schemas['schema:phone'] })

    const response = await request(app.getHttpServer()).get(
      '/v2/anoncreds/credential-definitions/credDef%3Aa/export',
    )

    expect(response.status).toBe(200)
    expect(credentialDefinitionRepository.findByCredentialDefinitionId).toHaveBeenCalledWith(
      agent.context,
      'credDef:a',
    )
    expect(response.body.id).toBe('credDef:a')
    expect(response.body.data.relatedJsonSchemaCredentialId).toBe('https://tr.test/phone-jsc.json')
    expect(response.body.data.credentialDefinitionPrivate).toEqual({ private: true })
    expect(response.body.data.keyCorrectnessProof).toEqual({ kcp: true })
  })

  it('answers UNKNOWN_ID when exporting an unknown credential definition', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(null)

    const response = await request(app.getHttpServer()).get(
      '/v2/anoncreds/credential-definitions/nope/export',
    )

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('imports a package and returns the record with its governing credential', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(null)
    schemaRepository.findBySchemaId.mockResolvedValue({ schema: schemas['schema:phone'] })
    const saved: Record<string, string> = {}
    credentialDefinitionRepository.getById.mockResolvedValue({
      setTag: (key: string, value: string) => {
        saved[key] = value
      },
    })

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions/import')
      .send({
        id: 'credDef:imported',
        data: {
          name: 'phoneNumber',
          version: '1.0',
          relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
          credentialDefinition: { schemaId: 'schema:phone', issuerId: 'did:web:other.test', value: {} },
          credentialDefinitionPrivate: { private: true },
          keyCorrectnessProof: { kcp: true },
          schema: schemas['schema:phone'],
        },
      })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      id: 'credDef:imported',
      name: 'phoneNumber',
      version: '1.0',
      attributes: ['phoneNumber'],
      supportRevocation: false,
      relatedJsonSchemaCredentialId: 'https://tr.test/phone-jsc.json',
    })
    expect(saved.relatedJsonSchemaCredentialId).toBe('https://tr.test/phone-jsc.json')
    expect(credentialDefinitionPrivateRepository.save).toHaveBeenCalled()
    expect(keyCorrectnessProofRepository.save).toHaveBeenCalled()
  })

  it('rejects a malformed package with INVALID_PACKAGE', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(null)

    const missingCryptoData = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions/import')
      .send({ id: 'credDef:imported', data: { credentialDefinition: { schemaId: 'schema:phone' } } })

    expect(missingCryptoData.status).toBe(400)
    expect(missingCryptoData.body.error.code).toBe('INVALID_PACKAGE')

    const missingCredentialDefinition = await request(app.getHttpServer())
      .post('/v2/anoncreds/credential-definitions/import')
      .send({ id: 'credDef:imported', data: { name: 'phoneNumber' } })

    expect(missingCredentialDefinition.status).toBe(400)
    expect(missingCredentialDefinition.body.error.code).toBe('INVALID_PACKAGE')
  })

  it('deletes a credential definition addressed by the path and answers 204', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(records[0])
    credentialDefinitionPrivateRepository.findByCredentialDefinitionId.mockResolvedValue({ id: 'priv' })
    keyCorrectnessProofRepository.findByCredentialDefinitionId.mockResolvedValue({ id: 'kcp' })

    const response = await request(app.getHttpServer()).delete(
      '/v2/anoncreds/credential-definitions/credDef%3Aa',
    )

    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
    expect(credentialDefinitionRepository.findByCredentialDefinitionId).toHaveBeenCalledWith(
      agent.context,
      'credDef:a',
    )
    expect(credentialDefinitionPrivateRepository.delete).toHaveBeenCalled()
    expect(keyCorrectnessProofRepository.delete).toHaveBeenCalled()
    expect(credentialDefinitionRepository.delete).toHaveBeenCalledWith(agent.context, records[0])
    expect(credentialTypesService.deleteRevocationRegistry).not.toHaveBeenCalled()
  })

  it('cascades to the revocation registries only when the caller asks for it', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(records[1])
    credentialDefinitionPrivateRepository.findByCredentialDefinitionId.mockResolvedValue(null)
    keyCorrectnessProofRepository.findByCredentialDefinitionId.mockResolvedValue(null)
    revocationDefinitionRepository.findAllByCredentialDefinitionId.mockResolvedValue([
      { revocationRegistryDefinitionId: 'revReg:1' },
      { revocationRegistryDefinitionId: 'revReg:2' },
    ])

    const response = await request(app.getHttpServer()).delete(
      '/v2/anoncreds/credential-definitions/credDef%3Ab?deleteAssociatedRevocationRegistries=true',
    )

    expect(response.status).toBe(204)
    expect(credentialTypesService.deleteRevocationRegistry).toHaveBeenCalledTimes(2)
    expect(credentialTypesService.deleteRevocationRegistry).toHaveBeenCalledWith(agent, 'revReg:1')
  })

  it('answers UNKNOWN_ID when deleting an unknown credential definition', async () => {
    credentialDefinitionRepository.findByCredentialDefinitionId.mockResolvedValue(null)

    const response = await request(app.getHttpServer()).delete('/v2/anoncreds/credential-definitions/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(credentialDefinitionRepository.delete).not.toHaveBeenCalled()
  })
})
