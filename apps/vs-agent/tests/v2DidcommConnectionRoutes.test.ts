import type { INestApplication } from '@nestjs/common'

import { RecordNotFoundError } from '@credo-ts/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorEnvelopeFilter } from '../src/common'
import { V2DidcommConnectionsController } from '../src/controllers/admin/v2/didcomm/V2DidcommConnectionsController'
import { ListConnectionsQueryDto } from '../src/controllers/admin/v2/didcomm/dto'
import { VsAgentService } from '../src/services/VsAgentService'

const connection = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  state: 'completed',
  role: 'responder',
  did: `did:web:agent.test:${id}`,
  theirDid: `did:web:peer.test:${id}`,
  threadId: `thread-${id}`,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  ...extra,
})

// Deliberately out of order: the controller owes a deterministic order of its own.
const records = [
  connection('c-2', '2026-01-02T00:00:00.000Z'),
  connection('c-3', '2026-01-03T00:00:00.000Z', { mediatorId: 'med-1' }),
  connection('c-1', '2026-01-01T00:00:00.000Z'),
]

const connections = {
  findAllByQuery: vi.fn(),
  findById: vi.fn(),
  deleteById: vi.fn(),
}

const vsAgentService = { getAgent: vi.fn().mockResolvedValue({ didcomm: { connections } }) }

const idsOf = (body: { items: { id: string }[] }) => body.items.map(item => item.id)

describe('v2 didcomm connection routes', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V2DidcommConnectionsController],
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
    connections.findAllByQuery.mockResolvedValue(records)
  })

  it('walks the connections with the keyset cursor and ends with a null cursor', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/connections?limit=2')

    expect(first.status).toBe(200)
    expect(idsOf(first.body)).toEqual(['c-1', 'c-2'])
    expect(first.body.nextCursor).not.toBeNull()

    const second = await request(app.getHttpServer()).get(
      `/v2/didcomm/connections?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(idsOf(second.body)).toEqual(['c-3'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('refuses a cursor replayed against another filter set', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/connections?limit=1')

    const replayed = await request(app.getHttpServer()).get(
      `/v2/didcomm/connections?limit=1&role=responder&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(replayed.status).toBe(400)
    expect(replayed.body.error.code).toBe('INVALID_CURSOR')
  })

  it('passes every supplied filter to the connection repository', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v2/didcomm/connections?state=completed&role=responder&theirDid=did:web:peer.test&mediatorId=med-1&didcommVersion=v2',
    )

    expect(response.status).toBe(200)
    expect(connections.findAllByQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'completed',
        role: 'responder',
        theirDid: 'did:web:peer.test',
        mediatorId: 'med-1',
        didcommVersion: 'v2',
      }),
    )
  })

  // Credo writes the didcommVersion tag only for v2 out-of-band connections and treats its
  // absence as v1, so a v1 filter has to be the negation of v2 rather than a tag match.
  it('translates a v1 version filter into the negation of v2', async () => {
    const response = await request(app.getHttpServer()).get('/v2/didcomm/connections?didcommVersion=v1')

    expect(response.status).toBe(200)
    const [query] = connections.findAllByQuery.mock.calls[0]
    expect(query.$and[1]).toEqual({ $not: { didcommVersion: 'v2' } })
    // The tag must not also be asserted as a value, or nothing would ever match.
    expect(query.$and[0]).not.toHaveProperty('didcommVersion')
  })

  it('keeps the other filters alongside the negated version', async () => {
    await request(app.getHttpServer()).get(
      '/v2/didcomm/connections?didcommVersion=v1&state=completed&role=responder',
    )

    const [query] = connections.findAllByQuery.mock.calls[0]
    expect(query.$and[0]).toMatchObject({ state: 'completed', role: 'responder' })
    expect(query.$and[1]).toEqual({ $not: { didcommVersion: 'v2' } })
  })

  it('leaves a v2 version filter as a plain tag match', async () => {
    await request(app.getHttpServer()).get('/v2/didcomm/connections?didcommVersion=v2')

    expect(connections.findAllByQuery).toHaveBeenCalledWith(expect.objectContaining({ didcommVersion: 'v2' }))
    expect(connections.findAllByQuery.mock.calls[0][0].$and).toBeUndefined()
  })

  it('keys the pagination cursor on the requested version, not on the translated query', async () => {
    const first = await request(app.getHttpServer()).get('/v2/didcomm/connections?didcommVersion=v1&limit=2')

    const second = await request(app.getHttpServer()).get(
      `/v2/didcomm/connections?didcommVersion=v1&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
  })

  // Driven through the pipe rather than over HTTP: esbuild drops the design:paramtypes
  // metadata that the global pipe infers the DTO from, so the route cannot be made to
  // validate under vitest. `nest build` emits it, so the deployed route does validate.
  it('rejects a state outside the DID exchange state machine', async () => {
    const pipe = new ValidationPipe()
    const metadata = { type: 'query', metatype: ListConnectionsQueryDto } as const

    await expect(pipe.transform({ state: 'not-a-state' }, metadata)).rejects.toMatchObject({
      status: 400,
    })
    await expect(pipe.transform({ state: 'completed' }, metadata)).resolves.toBeDefined()
  })

  it('returns one connection in the shape the listing uses', async () => {
    connections.findById.mockResolvedValue(records[2])

    const [list, single] = await Promise.all([
      request(app.getHttpServer()).get('/v2/didcomm/connections?limit=1'),
      request(app.getHttpServer()).get('/v2/didcomm/connections/c-1'),
    ])

    expect(single.status).toBe(200)
    expect(single.body).toEqual(list.body.items[0])
  })

  it('reports an unknown connection as UNKNOWN_ID', async () => {
    connections.findById.mockResolvedValue(null)

    const response = await request(app.getHttpServer()).get('/v2/didcomm/connections/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('deletes a connection and answers 204 with an empty body', async () => {
    connections.deleteById.mockResolvedValue(undefined)

    const response = await request(app.getHttpServer()).delete('/v2/didcomm/connections/c-1')

    expect(response.status).toBe(204)
    expect(response.body).toEqual({})
    expect(connections.deleteById).toHaveBeenCalledWith('c-1')
  })

  it('reports a delete of an unknown connection as UNKNOWN_ID', async () => {
    connections.deleteById.mockRejectedValue(new RecordNotFoundError('not found', { recordType: 'x' }))

    const response = await request(app.getHttpServer()).delete('/v2/didcomm/connections/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
  })

  it('does not collapse an unexpected storage failure into UNKNOWN_ID', async () => {
    connections.deleteById.mockRejectedValue(new Error('askar rejected the write'))

    const response = await request(app.getHttpServer()).delete('/v2/didcomm/connections/c-1')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('INTERNAL')
  })
})
