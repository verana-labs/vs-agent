import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRole,
  DidCommConnectionEventTypes,
  DidCommProofEventTypes,
} from '@credo-ts/didcomm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { webhookEvent } from '../src/utils/webhookEvent'

type Handler = (event: { payload: unknown }) => unknown
type Middleware = (context: unknown, next: () => Promise<void>) => Promise<void>

const URL = 'https://backend.example/events'
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const fetchMock = vi.fn()

function fakeAgent() {
  const handlers = new Map<string, Handler>()
  const middlewares: Middleware[] = []
  const agent = {
    events: { on: (type: string, handler: Handler) => handlers.set(type, handler) },
    didcomm: {
      registerMessageHandlerMiddleware: (middleware: Middleware) => middlewares.push(middleware),
      proofs: {
        getFormatData: vi.fn().mockResolvedValue({
          presentation: { anoncreds: { requested_proof: { revealed_attrs: { name: { raw: 'Alice' } } } } },
        }),
      },
      credentials: {
        getFormatData: vi.fn().mockResolvedValue({ offerAttributes: [{ name: 'name', value: 'Alice' }] }),
      },
    },
  }
  return {
    agent,
    emit: (type: string, payload: unknown) => handlers.get(type)?.({ payload }),
    process: (context: unknown) => middlewares[0](context, async () => {}),
  }
}

async function delivered(): Promise<{ init: RequestInit; body: Record<string, any> }> {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(URL)
  return { init, body: JSON.parse(init.body as string) }
}

const connectionRecord = {
  id: 'conn-1',
  state: 'completed',
  role: 'responder',
  did: 'did:peer:1',
  createdAt: new Date('2026-09-01T00:00:00Z'),
}

describe('Events API delivery', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    logger.error.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('posts one envelope to the webhook url with the bearer key', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL, apiKey: 'secret' }, logger as never)

    emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, {
      connectionRecord,
      previousState: null,
    })

    const { init, body } = await delivered()
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer secret' })
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.type).toBe('didcomm.connections.state-updated')
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(body.data).toMatchObject({ id: 'conn-1', state: 'completed', previousState: null })
  })

  it('delivers a received basic message as its record and ignores sent ones', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    const record = {
      id: 'bm-1',
      connectionId: 'conn-1',
      content: 'hello',
      sentTime: '2026-09-01T00:00:00Z',
      createdAt: new Date('2026-09-01T00:00:01Z'),
    }
    emit(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, {
      basicMessageRecord: { ...record, role: DidCommBasicMessageRole.Sender },
    })
    emit(DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged, {
      basicMessageRecord: { ...record, role: DidCommBasicMessageRole.Receiver },
    })

    const { body } = await delivered()
    expect(body.type).toBe('didcomm.basic-messages.message-received')
    expect(body.data).toEqual({
      id: 'bm-1',
      connectionId: 'conn-1',
      role: 'receiver',
      content: 'hello',
      sentTime: '2026-09-01T00:00:00Z',
      createdAt: '2026-09-01T00:00:01.000Z',
    })
  })

  it('delivers receipts and extension module messages once the handler processed them', async () => {
    const { agent, process } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)
    const connection = { id: 'conn-1' }

    await process({
      connection,
      message: {
        type: 'https://didcomm.org/receipts/1.0/message-receipts',
        threadId: 't-1',
        receipts: [{ messageId: 'm-1', state: 'viewed', timestamp: new Date('2026-09-01T00:00:00Z') }],
      },
    })
    const receipts = (await delivered()).body
    expect(receipts.type).toBe('didcomm.receipts.message-receipts-received')
    expect(receipts.data).toEqual({
      connectionId: 'conn-1',
      receipts: [{ messageId: 'm-1', state: 'viewed', timestamp: '2026-09-01T00:00:00.000Z' }],
    })

    fetchMock.mockClear()
    const plaintext = { '@type': 'https://didcomm.org/reactions/1.0/message-reactions', reactions: [] }
    await process({
      connection,
      message: { type: plaintext['@type'], threadId: 't-2', toJSON: () => plaintext },
    })
    const reactions = (await delivered()).body
    expect(reactions.type).toBe('didcomm.reactions.message-reactions-received')
    expect(reactions.data).toEqual({ connectionId: 'conn-1', threadId: 't-2', message: plaintext })

    fetchMock.mockClear()
    await process({
      connection,
      message: { type: 'https://didcomm.org/trust-ping/1.0/ping', threadId: 't-3', toJSON: () => ({}) },
    })
    await process({
      message: { type: plaintext['@type'], threadId: 't-4', toJSON: () => plaintext },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delivers an abandoned presentation with its reason in the record', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(DidCommProofEventTypes.ProofStateChanged, {
      proofRecord: {
        id: 'proof-1',
        state: 'abandoned',
        role: 'verifier',
        connectionId: 'conn-1',
        errorMessage: 'e.req.no-compatible-credentials: no matching credentials',
        createdAt: new Date(),
        metadata: { get: () => null },
      },
      previousState: 'request-sent',
    })

    const { body } = await delivered()
    expect(body.type).toBe('didcomm.presentations.state-updated')
    expect(body.data).toMatchObject({
      proofExchangeId: 'proof-1',
      state: 'abandoned',
      role: 'verifier',
      connectionId: 'conn-1',
      verified: false,
      errorMessage: 'e.req.no-compatible-credentials: no matching credentials',
      previousState: 'request-sent',
    })
  })

  it('logs a record that cannot be mapped instead of rejecting the listener', async () => {
    const { agent, emit } = fakeAgent()
    agent.didcomm.proofs.getFormatData.mockRejectedValueOnce(new Error('record deleted'))
    webhookEvent(agent as never, { url: URL }, logger as never)

    await emit(DidCommProofEventTypes.ProofStateChanged, {
      proofRecord: { id: 'proof-1', state: 'done', createdAt: new Date(), metadata: { get: () => null } },
      previousState: null,
    })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs a failed delivery and never throws', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 })
    emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, { connectionRecord, previousState: null })
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))
    expect(logger.error.mock.calls[0][0]).toMatch(/didcomm\.connections\.state-updated .* HTTP 502$/)

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, { connectionRecord, previousState: null })
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(2))
  })
})
