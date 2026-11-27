import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ChatPlugin } from '@verana-labs/vs-agent-plugin-chat'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'

const media = { create: vi.fn(), share: vi.fn() }
const agent = { isInitialized: true, context: { dependencyManager: {} }, didcomm: {}, modules: { media } }

const items = [{ uri: 'https://media.example/1', mimeType: 'image/png' }]

describe('POST /v2/didcomm/media-sharing', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VsAgentModule.register(agent as never, 'http://localhost:3001', [ChatPlugin()])],
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
    media.create.mockResolvedValue({ id: 'media-record-1' })
    media.share.mockResolvedValue({ id: 'media-record-1', threadId: 'share-message-1' })
  })

  it('shares the items as the answer to the request named as the parent thread', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/media-sharing')
      .send({ connectionId: 'conn-1', parentThreadId: 'request-1', description: 'the photo', items })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'share-message-1' })
    expect(media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        parentThreadId: 'request-1',
        description: 'the photo',
      }),
    )
    expect(media.share).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'media-record-1', parentThreadId: 'request-1' }),
    )
    expect(media.create.mock.calls[0][0].items).toHaveLength(1)
  })

  it('shares without a parent thread when the body names none', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/media-sharing')
      .send({ connectionId: 'conn-1', items })

    expect(response.status).toBe(201)
    expect(media.create.mock.calls[0][0].parentThreadId).toBeUndefined()
    expect(media.share.mock.calls[0][0].parentThreadId).toBeUndefined()
  })

  it('rejects an empty parent thread, and the former threadId field', async () => {
    const empty = await request(app.getHttpServer())
      .post('/v2/didcomm/media-sharing')
      .send({ connectionId: 'conn-1', parentThreadId: '', items })
    const renamed = await request(app.getHttpServer())
      .post('/v2/didcomm/media-sharing')
      .send({ connectionId: 'conn-1', threadId: 'request-1', items })

    expect(empty.status).toBe(400)
    expect(renamed.status).toBe(400)
    expect(media.create).not.toHaveBeenCalled()
  })
})
