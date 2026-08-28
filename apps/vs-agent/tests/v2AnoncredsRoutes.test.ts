import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { CredentialTypesService } from '../src/controllers/admin/credentials'
import { V2AnoncredsController } from '../src/controllers/admin/v2/anoncreds'
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
})
