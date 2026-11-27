import type { INestApplication } from '@nestjs/common'

import { RecordNotFoundError } from '@credo-ts/core'
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
const vsAgentService = { getAgent: vi.fn().mockResolvedValue({ didcomm: { basicMessages } }) }

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
  })

  it('sends a message on the connection and answers with the sent message id', async () => {
    basicMessages.sendMessage.mockResolvedValue(
      message('m-9', '2026-01-09T00:00:00.000Z', { role: 'sender' }),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: 'conn-1', content: 'hello' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'thread-m-9' })
    expect(basicMessages.sendMessage).toHaveBeenCalledWith('conn-1', 'hello', undefined)
  })

  it('sends a reply with the message that it answers as its parent thread', async () => {
    basicMessages.sendMessage.mockResolvedValue(
      message('m-9', '2026-01-09T00:00:00.000Z', { role: 'sender', parentThreadId: 'thread-m-1' }),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: 'conn-1', content: 'yes', parentThreadId: 'thread-m-1' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'thread-m-9' })
    expect(basicMessages.sendMessage).toHaveBeenCalledWith('conn-1', 'yes', 'thread-m-1')
  })

  it('rejects an empty parent thread, or one that is not a string', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })
    const metadata = { type: 'body', metatype: SendBasicMessageBodyDto } as const
    const body = { connectionId: 'conn-1', content: 'yes' }

    await expect(pipe.transform({ ...body, parentThreadId: '' }, metadata)).rejects.toMatchObject({
      status: 400,
    })
    await expect(pipe.transform({ ...body, parentThreadId: 7 }, metadata)).rejects.toMatchObject({
      status: 400,
    })
    await expect(pipe.transform({ ...body, parentThreadId: 'thread-m-1' }, metadata)).resolves.toBeDefined()
  })

  it('reports the connection that the agent did not find as UNKNOWN_ID', async () => {
    basicMessages.sendMessage.mockRejectedValue(
      new RecordNotFoundError('record with id "nope" not found', {
        recordType: 'DidCommConnectionRecord',
      }),
    )

    const response = await request(app.getHttpServer())
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: 'nope', content: 'hello' })

    expect(response.status).toBe(404)
    expect(response.body.error).toEqual({
      code: 'UNKNOWN_ID',
      message: 'no record with the supplied identifier',
    })
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

  it('returns exactly the fields of the record, with the thread of the message', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/basic-messages?limit=1')

    expect(response.body.items[0]).toEqual({
      id: 'm-1',
      connectionId: 'conn-1',
      role: 'receiver',
      content: 'content of m-1',
      sentTime: '2026-01-01T00:00:00.000Z',
      threadId: 'thread-m-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('returns the parent thread of a reply, and none on a message that answers no other', async () => {
    basicMessages.findAllByQuery.mockResolvedValue([
      message('m-1', '2026-01-01T00:00:00.000Z', { role: 'sender' }),
      message('m-2', '2026-01-02T00:00:00.000Z', { parentThreadId: 'thread-m-1' }),
    ])

    const response = await request(app.getHttpServer()).get('/v2/didcomm/basic-messages')

    expect(response.body.items[0]).not.toHaveProperty('parentThreadId')
    expect(response.body.items[1]).toMatchObject({ id: 'm-2', parentThreadId: 'thread-m-1' })
  })

  it('rejects a role outside sender and receiver', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'query', metatype: ListBasicMessagesQueryDto } as const

    await expect(pipe.transform({ role: 'owner' }, metadata)).rejects.toMatchObject({ status: 400 })
    await expect(pipe.transform({ role: 'sender' }, metadata)).resolves.toBeDefined()
  })
})
