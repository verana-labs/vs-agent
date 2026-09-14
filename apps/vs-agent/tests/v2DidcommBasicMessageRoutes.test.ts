import type { INestApplication } from '@nestjs/common'

import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { V2DidcommBasicMessagesController } from '../src/controllers/admin/v2/didcomm/V2DidcommBasicMessagesController'
import { ListBasicMessagesQueryDto, SendBasicMessageBodyDto } from '../src/controllers/admin/v2/didcomm/dto'
import { VsAgentService } from '../src/services/VsAgentService'

const message = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  connectionId: 'conn-1',
  role: 'receiver',
  content: `content of ${id}`,
  sentTime: createdAt,
  createdAt: new Date(createdAt),
  threadId: `thread-${id}`,
  protocolVersion: 'v1',
  ...extra,
})

const records = [
  message('m-2', '2026-01-02T00:00:00.000Z'),
  message('m-3', '2026-01-03T00:00:00.000Z', { role: 'sender' }),
  message('m-1', '2026-01-01T00:00:00.000Z'),
]

const basicMessages = { sendMessage: vi.fn(), findAllByQuery: vi.fn() }
const connections = { findById: vi.fn() }
const vsAgentService = { getAgent: vi.fn().mockResolvedValue({ didcomm: { basicMessages, connections } }) }

const idsOf = (body: { items: { id: string }[] }) => body.items.map(item => item.id)

describe('v2 didcomm basic message routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommBasicMessagesController],
      providers: [{ provide: VsAgentService, useValue: vsAgentService }],
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
    basicMessages.findAllByQuery.mockResolvedValue(records)
    connections.findById.mockResolvedValue({ id: 'conn-1' })
  })

  it('sends a message on the connection and answers with the record id', async () => {
    basicMessages.sendMessage.mockResolvedValue(
      message('m-9', '2026-01-09T00:00:00.000Z', { role: 'sender' }),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: 'conn-1', content: 'hello' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'm-9' })
    expect(basicMessages.sendMessage).toHaveBeenCalledWith('conn-1', 'hello')
  })

  it('reports an unknown connection as UNKNOWN_ID and sends nothing', async () => {
    connections.findById.mockResolvedValue(null)

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: 'nope', content: 'hello' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(basicMessages.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects a body without content, or with an empty one', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })
    const metadata = { type: 'body', metatype: SendBasicMessageBodyDto } as const

    await expect(pipe.transform({ connectionId: 'conn-1' }, metadata)).rejects.toMatchObject({ status: 400 })
    await expect(pipe.transform({ connectionId: 'conn-1', content: '' }, metadata)).rejects.toMatchObject({
      status: 400,
    })
    await expect(pipe.transform({ connectionId: 'conn-1', content: 'hi' }, metadata)).resolves.toBeDefined()
  })

  it('walks the messages with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/basic-messages?limit=2')

    expect(first.status).toBe(200)
    expect(idsOf(first.body)).toEqual(['m-1', 'm-2'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/didcomm/basic-messages?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(idsOf(second.body)).toEqual(['m-3'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('passes the connection and role filters to the repository', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v2/didcomm/basic-messages?connectionId=conn-1&role=receiver',
    )

    expect(response.status).toBe(200)
    expect(basicMessages.findAllByQuery).toHaveBeenCalledWith({ connectionId: 'conn-1', role: 'receiver' })
  })

  it('refuses a cursor replayed against another filter set', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/basic-messages?limit=1')

    const replayed = await request(app.getHttpServer()).get(
      `/v2/didcomm/basic-messages?limit=1&role=sender&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(replayed.status).toBe(400)
    expect(replayed.body.error.code).toBe('INVALID_CURSOR')
  })

  it('returns exactly the fields the spec names on each record', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/basic-messages?limit=1')

    expect(response.body.items[0]).toEqual({
      id: 'm-1',
      connectionId: 'conn-1',
      role: 'receiver',
      content: 'content of m-1',
      sentTime: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('rejects a role outside sender and receiver', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'query', metatype: ListBasicMessagesQueryDto } as const

    await expect(pipe.transform({ role: 'owner' }, metadata)).rejects.toMatchObject({ status: 400 })
    await expect(pipe.transform({ role: 'sender' }, metadata)).resolves.toBeDefined()
  })
})
