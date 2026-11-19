import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { MrtdPlugin } from '@verana-labs/vs-agent-plugin-mrtd'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'

const mrtd = { requestEMrtdData: vi.fn() }
const agent = { isInitialized: true, context: { dependencyManager: {} }, didcomm: {}, modules: { mrtd } }

describe('POST /v2/didcomm/mrtd/request-emrtd', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VsAgentModule.register(agent as never, 'http://localhost:3001', [MrtdPlugin()])],
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
    mrtd.requestEMrtdData.mockResolvedValue({ messageId: 'emrtd-message' })
  })

  it('names the MRZ exchange as the parent thread of the request', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-emrtd')
      .send({ connectionId: 'conn-1', parentThreadId: 'mrz-thread-1' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'emrtd-message' })
    expect(mrtd.requestEMrtdData).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      parentThreadId: 'mrz-thread-1',
    })
  })

  it('sends the request without a parent thread when the body has none', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-emrtd')
      .send({ connectionId: 'conn-1' })

    expect(response.status).toBe(201)
    expect(mrtd.requestEMrtdData).toHaveBeenCalledWith({ connectionId: 'conn-1', parentThreadId: undefined })
  })

  it('rejects an empty parent thread', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/mrtd/request-emrtd')
      .send({ connectionId: 'conn-1', parentThreadId: '' })

    expect(response.status).toBe(400)
    expect(mrtd.requestEMrtdData).not.toHaveBeenCalled()
  })
})
