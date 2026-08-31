import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { CredentialTypesService } from '../src/controllers/admin/credentials'
import { V2AnoncredsController } from '../src/controllers/admin/v2/anoncreds'
import { RevokeCredentialBodyDto } from '../src/controllers/admin/v2/anoncreds/dto'
import { VsAgentService } from '../src/services/VsAgentService'

const revocationRegistryDefinitionId = 'did:webvh:example:2060.io/resources/zQmRevRegDef'

const findByRevocationRegistryDefinitionId = vi.fn()

const agent = {
  context: {},
  dependencyManager: { resolve: () => ({ findByRevocationRegistryDefinitionId }) },
}

const vsAgentService = { getAgent: vi.fn().mockResolvedValue(agent) }

const credentialTypesService = {
  revokeCredential: vi.fn().mockResolvedValue({ timestamp: 1756377600 }),
}

describe('v2 anoncreds routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2AnoncredsController],
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
    credentialTypesService.revokeCredential.mockClear()
    findByRevocationRegistryDefinitionId.mockReset()
    findByRevocationRegistryDefinitionId.mockResolvedValue({
      revocationRegistryDefinition: { value: { maxCredNum: 1000 } },
    })
  })

  it('revokes the credential and confirms with the published status list timestamp', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revoke-credential')
      .send({ revocationRegistryDefinitionId, revocationRegistryIndex: 3 })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      revocationRegistryDefinitionId,
      revocationRegistryIndex: 3,
      revokedAt: '2025-08-28T10:40:00.000Z',
    })
    expect(credentialTypesService.revokeCredential).toHaveBeenCalledWith(
      agent,
      revocationRegistryDefinitionId,
      3,
    )
  })

  it('answers UNKNOWN_ID when the revocation registry definition is not known', async () => {
    findByRevocationRegistryDefinitionId.mockResolvedValue(null)

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revoke-credential')
      .send({ revocationRegistryDefinitionId, revocationRegistryIndex: 3 })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(credentialTypesService.revokeCredential).not.toHaveBeenCalled()
  })

  it('answers INVALID_INPUT when the index is beyond the registry capacity', async () => {
    findByRevocationRegistryDefinitionId.mockResolvedValue({
      revocationRegistryDefinition: { value: { maxCredNum: 10 } },
    })

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revoke-credential')
      .send({ revocationRegistryDefinitionId, revocationRegistryIndex: 11 })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
    expect(credentialTypesService.revokeCredential).not.toHaveBeenCalled()
  })

  it('revokes index 0, the first credential of every registry', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revoke-credential')
      .send({ revocationRegistryDefinitionId, revocationRegistryIndex: 0 })

    expect(response.status).toBe(200)
    expect(response.body.revocationRegistryIndex).toBe(0)
    expect(credentialTypesService.revokeCredential).toHaveBeenCalledWith(
      expect.anything(),
      revocationRegistryDefinitionId,
      0,
    )
  })

  it('revokes the last credential of the registry, at maxCredNum - 1', async () => {
    findByRevocationRegistryDefinitionId.mockResolvedValue({
      revocationRegistryDefinition: { value: { maxCredNum: 10 } },
    })

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revoke-credential')
      .send({ revocationRegistryDefinitionId, revocationRegistryIndex: 9 })

    expect(response.status).toBe(200)
    expect(credentialTypesService.revokeCredential).toHaveBeenCalledWith(
      expect.anything(),
      revocationRegistryDefinitionId,
      9,
    )
  })

  it('answers INVALID_INPUT for maxCredNum, which is one past the last index', async () => {
    findByRevocationRegistryDefinitionId.mockResolvedValue({
      revocationRegistryDefinition: { value: { maxCredNum: 10 } },
    })

    const response = await request(app.getHttpServer())
      .post('/v2/anoncreds/revoke-credential')
      .send({ revocationRegistryDefinitionId, revocationRegistryIndex: 10 })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
    expect(credentialTypesService.revokeCredential).not.toHaveBeenCalled()
  })

  // The ValidationPipe cannot run over HTTP here: vitest transpiles with esbuild, which drops the
  // `emitDecoratorMetadata` the pipe needs to resolve the body type. The DTO is validated directly.
  it('accepts index 0 and refuses a negative index in the body', async () => {
    const zero = await validate(
      plainToInstance(RevokeCredentialBodyDto, {
        revocationRegistryDefinitionId,
        revocationRegistryIndex: 0,
      }),
    )
    expect(zero).toHaveLength(0)

    const negative = await validate(
      plainToInstance(RevokeCredentialBodyDto, {
        revocationRegistryDefinitionId,
        revocationRegistryIndex: -1,
      }),
    )
    expect(negative.map(error => error.property)).toEqual(['revocationRegistryIndex'])
    expect(negative[0].constraints).toHaveProperty('min')
  })
})
