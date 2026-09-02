import type { INestApplication } from '@nestjs/common'

import { ConflictException, NotFoundException, ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AdminApiError, AdminApiErrorCode, ErrorEnvelopeFilter } from '../src/common'
import {
  ServiceEndpointError,
  ServiceEndpointErrorCode,
  ServiceEndpointsService,
} from '../src/controllers/admin/service-endpoints/ServiceEndpointsService'
import { V2VtFlowsController } from '../src/controllers/admin/v2/vt/V2VtFlowsController'
import { V2VtServiceEndpointsController } from '../src/controllers/admin/v2/vt/V2VtServiceEndpointsController'
import { V1TrustController } from '../src/controllers/admin/verifiable/V1TrustController'
import { TrustService } from '../src/controllers/admin/verifiable/TrustService'
import { VtFlowsService } from '../src/controllers/admin/vt-flow/VtFlowsService'

const entries = [
  { id: 'did:web:agent.test#a2a', type: 'A2A', serviceEndpoint: 'https://a2a.agent.test' },
  { id: 'did:web:agent.test#linked-domains', type: 'LinkedDomains', serviceEndpoint: 'https://agent.test' },
  { id: 'did:web:agent.test#mcp', type: 'MCP', serviceEndpoint: 'https://mcp.agent.test' },
]

const serviceEndpointsService = {
  list: vi.fn().mockResolvedValue(entries),
  add: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

const vtFlowsService = {
  listFlowsPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getFlow: vi.fn(),
  editCredentialClaims: vi.fn(),
  sendOobLink: vi.fn(),
  revokeFlowCredential: vi.fn(),
}

const trustService = {
  getVerifiableTrustCredential: vi.fn().mockResolvedValue([]),
  getJsonSchemaCredential: vi.fn().mockResolvedValue([]),
}

describe('v2 vt routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2VtServiceEndpointsController, V2VtFlowsController, V1TrustController],
      providers: [
        { provide: ServiceEndpointsService, useValue: serviceEndpointsService },
        { provide: VtFlowsService, useValue: vtFlowsService },
        { provide: TrustService, useValue: trustService },
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

  it('walks the service endpoints with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/vt/service-endpoints?limit=2')

    expect(first.status).toBe(200)
    expect(first.body.items.map((entry: { id: string }) => entry.id)).toEqual([
      'did:web:agent.test#a2a',
      'did:web:agent.test#linked-domains',
    ])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/vt/service-endpoints?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(second.body.items.map((entry: { id: string }) => entry.id)).toEqual(['did:web:agent.test#mcp'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('rejects a malformed cursor with the INVALID_CURSOR envelope', async () => {
    const response = await request(app.getHttpServer()).get('/v2/vt/service-endpoints?cursor=%25%25')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_CURSOR')
  })

  it('passes the percent-encoded serviceEndpointId through to the service', async () => {
    serviceEndpointsService.update.mockResolvedValue(entries[2])

    const response = await request(app.getHttpServer())
      .patch('/v2/vt/service-endpoints/%23mcp')
      .send({ serviceEndpoint: 'https://mcp2.agent.test' })

    expect(response.status).toBe(200)
    expect(serviceEndpointsService.update).toHaveBeenCalledWith('#mcp', {
      serviceEndpoint: 'https://mcp2.agent.test',
    })
  })

  it('rejects a patch that supplies neither type nor serviceEndpoint as INVALID_INPUT', async () => {
    const response = await request(app.getHttpServer()).patch('/v2/vt/service-endpoints/%23mcp').send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
  })

  it('envelopes an unknown id as UNKNOWN_ID', async () => {
    serviceEndpointsService.delete.mockRejectedValue(
      new ServiceEndpointError(ServiceEndpointErrorCode.NotFound, "No service entry with id '#nope'"),
    )

    const response = await request(app.getHttpServer()).delete('/v2/vt/service-endpoints/%23nope')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: { code: 'UNKNOWN_ID', message: "No service entry with id '#nope'" },
    })
  })

  it('envelopes a duplicate id as DUPLICATE_ID with status 409', async () => {
    serviceEndpointsService.add.mockRejectedValue(
      new ServiceEndpointError(ServiceEndpointErrorCode.DuplicateId, 'already exists'),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/vt/service-endpoints')
      .send({ type: 'MCP', serviceEndpoint: 'https://mcp.agent.test' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DUPLICATE_ID')
  })

  it('serves the flow page and envelopes flow errors per the v2 vocabulary', async () => {
    const page = await request(app.getHttpServer()).get('/v2/vt/flows')
    expect(page.status).toBe(200)
    expect(page.body).toEqual({ items: [], nextCursor: null })

    vtFlowsService.editCredentialClaims.mockRejectedValue(new NotFoundException('no vt-flow'))
    const missing = await request(app.getHttpServer()).put('/v2/vt/flows/missing/claims').send({ claims: {} })
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('UNKNOWN_ID')

    vtFlowsService.sendOobLink.mockRejectedValue(new ConflictException('not ESTABLISHED'))
    const conflict = await request(app.getHttpServer())
      .post('/v2/vt/flows/sess-1/oob-link')
      .send({ url: 'https://x' })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('INVALID_STATE')
  })

  it('serves one flow on the get-by-id route and envelopes an unknown session as UNKNOWN_ID', async () => {
    vtFlowsService.getFlow.mockResolvedValue({
      id: 'a',
      participantSessionId: 'sess-a',
      flowState: 'VALIDATING',
      connectionState: 'ESTABLISHED',
    })
    const found = await request(app.getHttpServer()).get('/v2/vt/flows/sess-a')
    expect(found.status).toBe(200)
    expect(vtFlowsService.getFlow).toHaveBeenCalledWith('sess-a')
    expect(found.body).toMatchObject({ flowState: 'VALIDATING', connectionState: 'ESTABLISHED' })

    vtFlowsService.getFlow.mockRejectedValue(
      new AdminApiError(AdminApiErrorCode.UnknownId, 404, 'no vt-flow with participantSessionId "nope"'),
    )
    const missing = await request(app.getHttpServer()).get('/v2/vt/flows/nope')
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('UNKNOWN_ID')
  })

  it('keeps the v1 GET methods and drops the trimmed v1 mutations', async () => {
    expect((await request(app.getHttpServer()).get('/v1/vt/linked-credentials')).status).toBe(200)
    expect((await request(app.getHttpServer()).get('/v1/vt/json-schema-credentials')).status).toBe(200)

    expect((await request(app.getHttpServer()).post('/v1/vt/linked-credentials').send({})).status).toBe(404)
    expect((await request(app.getHttpServer()).delete('/v1/vt/linked-credentials')).status).toBe(404)
    expect((await request(app.getHttpServer()).post('/v1/vt/json-schema-credentials').send({})).status).toBe(
      404,
    )
    expect((await request(app.getHttpServer()).delete('/v1/vt/json-schema-credentials')).status).toBe(404)
  })
})
