import type { INestApplication } from '@nestjs/common'

import { AnonCredsRevocationRegistryDefinitionRepository } from '@credo-ts/anoncreds'
import { HttpStatus, ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminApiError, AdminApiErrorCode, ErrorEnvelopeFilter } from '../src/common'
import { REVOCATION_REGISTRY_DEFAULT_CAPACITY } from '../src/config/constants'
import { CredentialTypesService } from '../src/controllers/admin/credentials'
import { V2AnoncredsRevocationRegistriesController } from '../src/controllers/admin/v2/anoncreds/V2AnoncredsRevocationRegistriesController'
import {
  CreateRevocationRegistryBodyDto,
  ListRevocationRegistriesQueryDto,
} from '../src/controllers/admin/v2/anoncreds/dto'
import { VsAgentService } from '../src/services/VsAgentService'

const credentialDefinitionId = 'did:web:agent.test?service=anoncreds&relativeRef=/credDef/cd-1'
const revocationRegistryDefinitionId = 'did:web:agent.test?service=anoncreds&relativeRef=/revRegDef/rr-1'

// Deliberately out of order: the controller owes a deterministic order of its own.
const registryIds = [
  'did:web:agent.test?service=anoncreds&relativeRef=/revRegDef/rr-2',
  'did:web:agent.test?service=anoncreds&relativeRef=/revRegDef/rr-3',
  'did:web:agent.test?service=anoncreds&relativeRef=/revRegDef/rr-1',
]

const credentialTypesService = {
  listRevocationRegistries: vi.fn(),
  createRevocationRegistry: vi.fn(),
  deleteRevocationRegistry: vi.fn(),
}

const vsAgentService = { getAgent: vi.fn().mockResolvedValue({}) }

describe('v2 anoncreds revocation registry routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2AnoncredsRevocationRegistriesController],
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
    credentialTypesService.listRevocationRegistries.mockResolvedValue(registryIds)
  })

  it('walks the registries with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/anoncreds/revocation-registries?limit=2')

    expect(first.status).toBe(200)
    expect(first.body.items).toEqual([registryIds[2], registryIds[0]])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/anoncreds/revocation-registries?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(second.body.items).toEqual([registryIds[1]])
    expect(second.body.nextCursor).toBeNull()
  })

  it('passes the credential definition filter down to the store', async () => {
    const response = await request(app.getHttpServer()).get(
      `/v2/anoncreds/revocation-registries?credentialDefinitionId=${encodeURIComponent(credentialDefinitionId)}`,
    )

    expect(response.status).toBe(200)
    expect(credentialTypesService.listRevocationRegistries).toHaveBeenCalledWith({}, credentialDefinitionId)
  })

  it('refuses a cursor replayed against another filter set', async () => {
    const first = await request(app.getHttpServer()).get('/v2/anoncreds/revocation-registries?limit=1')

    const replayed = await request(app.getHttpServer()).get(
      `/v2/anoncreds/revocation-registries?limit=1&credentialDefinitionId=${encodeURIComponent(
        credentialDefinitionId,
      )}&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(replayed.status).toBe(400)
    expect(replayed.body.error.code).toBe('INVALID_CURSOR')
  })

  it('creates a registry and answers 201 with its identifier', async () => {
    credentialTypesService.createRevocationRegistry.mockResolvedValue(revocationRegistryDefinitionId)

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revocation-registries')
      .send({ credentialDefinitionId, maximumCredentialNumber: 500 })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ revocationRegistryDefinitionId })
    expect(credentialTypesService.createRevocationRegistry).toHaveBeenCalledWith(
      {},
      { credentialDefinitionId, maximumCredentialNumber: 500 },
    )
  })

  it('leaves the capacity unset when the caller omits it, so the default applies', async () => {
    credentialTypesService.createRevocationRegistry.mockResolvedValue(revocationRegistryDefinitionId)

    await request(app.getHttpServer())
      .post('/v2/anoncreds/revocation-registries')
      .send({ credentialDefinitionId })

    expect(credentialTypesService.createRevocationRegistry).toHaveBeenCalledWith(
      {},
      { credentialDefinitionId, maximumCredentialNumber: undefined },
    )
  })

  it('reports a create against an unknown credential definition as UNKNOWN_ID', async () => {
    credentialTypesService.createRevocationRegistry.mockRejectedValue(
      new AdminApiError(AdminApiErrorCode.UnknownId, HttpStatus.NOT_FOUND, 'no credential definition'),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revocation-registries')
      .send({ credentialDefinitionId })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('reports a create against a non-revocable credential definition as INVALID_STATE', async () => {
    credentialTypesService.createRevocationRegistry.mockRejectedValue(
      new AdminApiError(AdminApiErrorCode.InvalidState, HttpStatus.CONFLICT, 'does not support revocation'),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revocation-registries')
      .send({ credentialDefinitionId })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('INVALID_STATE')
  })

  // Driven through the pipe rather than over HTTP: esbuild drops the design:paramtypes
  // metadata that the global pipe infers the DTO from, so the route cannot be made to
  // validate under vitest. `nest build` emits it, so the deployed route does validate.
  it('rejects a body without a credential definition, and a capacity below one', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'body', metatype: CreateRevocationRegistryBodyDto } as const

    await expect(pipe.transform({}, metadata)).rejects.toMatchObject({ status: 400 })
    await expect(
      pipe.transform({ credentialDefinitionId, maximumCredentialNumber: 0 }, metadata),
    ).rejects.toMatchObject({ status: 400 })
    await expect(pipe.transform({ credentialDefinitionId }, metadata)).resolves.toBeDefined()
  })

  it('rejects a capacity that is not a JSON number', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'body', metatype: CreateRevocationRegistryBodyDto } as const

    await expect(
      pipe.transform({ credentialDefinitionId, maximumCredentialNumber: '500' }, metadata),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      pipe.transform({ credentialDefinitionId, maximumCredentialNumber: 500 }, metadata),
    ).resolves.toBeDefined()
  })

  it('rejects an empty credential definition filter instead of ignoring it', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'query', metatype: ListRevocationRegistriesQueryDto } as const

    await expect(pipe.transform({ credentialDefinitionId: '' }, metadata)).rejects.toMatchObject({
      status: 400,
    })
    await expect(pipe.transform({ credentialDefinitionId }, metadata)).resolves.toBeDefined()
    await expect(pipe.transform({}, metadata)).resolves.toBeDefined()
  })

  it('deletes a registry and answers 204 with an empty body', async () => {
    credentialTypesService.deleteRevocationRegistry.mockResolvedValue(true)

    const response = await request(app.getHttpServer()).delete(
      `/v2/anoncreds/revocation-registries/${encodeURIComponent(revocationRegistryDefinitionId)}`,
    )

    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
    expect(credentialTypesService.deleteRevocationRegistry).toHaveBeenCalledWith(
      {},
      revocationRegistryDefinitionId,
    )
  })

  it('reports a delete of an unknown registry as UNKNOWN_ID', async () => {
    credentialTypesService.deleteRevocationRegistry.mockResolvedValue(false)

    const response = await request(app.getHttpServer()).delete('/v2/anoncreds/revocation-registries/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })
})

describe('CredentialTypesService revocation registries', () => {
  const revocationStatusList = { timestamp: 1700000000 }
  const revocationDefinitionRecord = { metadata: { set: vi.fn() } }

  const revocationDefinitionRepository = {
    getAll: vi.fn(),
    findAllByCredentialDefinitionId: vi.fn(),
    getByRevocationRegistryDefinitionId: vi.fn().mockResolvedValue(revocationDefinitionRecord),
    update: vi.fn(),
  }

  const anoncreds = {
    getCredentialDefinition: vi.fn(),
    registerRevocationRegistryDefinition: vi.fn(),
    registerRevocationStatusList: vi.fn(),
  }

  const agent = {
    context: { context: true },
    modules: { anoncreds },
    genericRecords: { save: vi.fn() },
    dependencyManager: {
      resolve: vi.fn(token =>
        token === AnonCredsRevocationRegistryDefinitionRepository ? revocationDefinitionRepository : {},
      ),
    },
  }

  const service = new CredentialTypesService({ getAgent: vi.fn() } as never)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(service, 'appendStatusListToRevocationRegistry').mockResolvedValue(undefined)
    vi.spyOn(service, 'deleteRevocationRegistry').mockResolvedValue(true)
    revocationDefinitionRepository.getByRevocationRegistryDefinitionId.mockResolvedValue(
      revocationDefinitionRecord,
    )
    anoncreds.getCredentialDefinition.mockResolvedValue({
      credentialDefinition: { issuerId: 'did:web:agent.test', value: { revocation: {} } },
    })
    anoncreds.registerRevocationRegistryDefinition.mockResolvedValue({
      revocationRegistryDefinitionState: { revocationRegistryDefinitionId },
      registrationMetadata: { attestedResource: { id: revocationRegistryDefinitionId } },
    })
    anoncreds.registerRevocationStatusList.mockResolvedValue({
      revocationStatusListState: { revocationStatusList },
      registrationMetadata: { attestedResource: { id: 'status-list-1' } },
    })
  })

  it('lists every registry when no credential definition is named', async () => {
    revocationDefinitionRepository.getAll.mockResolvedValue(
      registryIds.map(id => ({ revocationRegistryDefinitionId: id })),
    )

    await expect(service.listRevocationRegistries(agent as never)).resolves.toEqual(registryIds)
    expect(revocationDefinitionRepository.findAllByCredentialDefinitionId).not.toHaveBeenCalled()
  })

  it('lists only the registries of the named credential definition', async () => {
    revocationDefinitionRepository.findAllByCredentialDefinitionId.mockResolvedValue([
      { revocationRegistryDefinitionId },
    ])

    await expect(service.listRevocationRegistries(agent as never, credentialDefinitionId)).resolves.toEqual([
      revocationRegistryDefinitionId,
    ])
    expect(revocationDefinitionRepository.findAllByCredentialDefinitionId).toHaveBeenCalledWith(
      agent.context,
      credentialDefinitionId,
    )
    expect(revocationDefinitionRepository.getAll).not.toHaveBeenCalled()
  })

  it('registers the definition and its first status list with the default capacity', async () => {
    await expect(service.createRevocationRegistry(agent as never, { credentialDefinitionId })).resolves.toBe(
      revocationRegistryDefinitionId,
    )

    expect(anoncreds.registerRevocationRegistryDefinition).toHaveBeenCalledWith({
      revocationRegistryDefinition: {
        credentialDefinitionId,
        tag: 'default',
        maximumCredentialNumber: REVOCATION_REGISTRY_DEFAULT_CAPACITY,
        issuerId: 'did:web:agent.test',
      },
      options: {},
    })
    expect(service.appendStatusListToRevocationRegistry).toHaveBeenCalledWith(
      agent,
      revocationRegistryDefinitionId,
      { id: 'status-list-1' },
      revocationStatusList.timestamp,
    )
    expect(revocationDefinitionRecord.metadata.set).toHaveBeenCalledWith(
      'revStatusList',
      revocationStatusList,
    )
    expect(revocationDefinitionRepository.update).toHaveBeenCalledWith(
      agent.context,
      revocationDefinitionRecord,
    )
    expect(service.deleteRevocationRegistry).not.toHaveBeenCalled()
  })

  it('honours an explicit capacity', async () => {
    await service.createRevocationRegistry(agent as never, {
      credentialDefinitionId,
      maximumCredentialNumber: 42,
    })

    expect(anoncreds.registerRevocationRegistryDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        revocationRegistryDefinition: expect.objectContaining({ maximumCredentialNumber: 42 }),
      }),
    )
  })

  it('refuses an unknown credential definition with UNKNOWN_ID', async () => {
    anoncreds.getCredentialDefinition.mockResolvedValue({ credentialDefinition: undefined })

    await expect(
      service.createRevocationRegistry(agent as never, { credentialDefinitionId }),
    ).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
      status: HttpStatus.NOT_FOUND,
    })
    expect(anoncreds.registerRevocationRegistryDefinition).not.toHaveBeenCalled()
  })

  it('refuses a credential definition without revocation support with INVALID_STATE', async () => {
    anoncreds.getCredentialDefinition.mockResolvedValue({
      credentialDefinition: { issuerId: 'did:web:agent.test', value: {} },
    })

    await expect(
      service.createRevocationRegistry(agent as never, { credentialDefinitionId }),
    ).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidState,
      status: HttpStatus.CONFLICT,
    })
    expect(anoncreds.registerRevocationRegistryDefinition).not.toHaveBeenCalled()
  })

  it('reports the reason the registry gave when the definition cannot be registered', async () => {
    anoncreds.registerRevocationRegistryDefinition.mockResolvedValue({
      revocationRegistryDefinitionState: { state: 'failed', reason: 'no registry found for issuerId' },
      registrationMetadata: {},
    })

    await expect(
      service.createRevocationRegistry(agent as never, { credentialDefinitionId }),
    ).rejects.toThrow('no registry found for issuerId')
    expect(service.deleteRevocationRegistry).not.toHaveBeenCalled()
  })

  it('rolls the definition back, with the reason, when the status list cannot be registered', async () => {
    anoncreds.registerRevocationStatusList.mockResolvedValue({
      revocationStatusListState: { state: 'failed', reason: 'no previous status list found' },
      registrationMetadata: {},
    })

    await expect(
      service.createRevocationRegistry(agent as never, { credentialDefinitionId }),
    ).rejects.toThrow('no previous status list found')
    expect(service.deleteRevocationRegistry).toHaveBeenCalledWith(agent, revocationRegistryDefinitionId)
  })

  it('rolls the definition back when the first status list cannot be appended', async () => {
    vi.spyOn(service, 'appendStatusListToRevocationRegistry').mockRejectedValue(new Error('append failed'))

    await expect(
      service.createRevocationRegistry(agent as never, { credentialDefinitionId }),
    ).rejects.toThrow('append failed')
    expect(service.deleteRevocationRegistry).toHaveBeenCalledWith(agent, revocationRegistryDefinitionId)
  })
})
