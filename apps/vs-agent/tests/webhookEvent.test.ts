import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRole,
  DidCommConnectionEventTypes,
  DidCommCredentialEventTypes,
  DidCommEventTypes,
  DidCommProofEventTypes,
} from '@credo-ts/didcomm'
import { VtFlowStateUpdated } from '@verana-labs/vs-agent-model'
import { VsAgentEventTypes } from '@verana-labs/vs-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { webhookEvent } from '../src/utils/webhookEvent'

type Handler = (event: { payload: unknown }) => unknown

const URL = 'https://backend.example/events'
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const fetchMock = vi.fn()

function fakeAgent() {
  const handlers = new Map<string, Handler>()
  const agent = {
    events: { on: (type: string, handler: Handler) => handlers.set(type, handler) },
    didcomm: {
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
  return { agent, emit: (type: string, payload: unknown) => handlers.get(type)?.({ payload }) }
}

async function delivered(): Promise<{ init: RequestInit; body: Record<string, any> }> {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
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

  it('sends no authorization header without an api key', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, {
      connectionRecord,
      previousState: 'request-received',
    })

    const { init, body } = await delivered()
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(body.data.previousState).toBe('request-received')
  })

  it('delivers presentation and credential exchange records in their get shape', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(DidCommProofEventTypes.ProofStateChanged, {
      proofRecord: {
        id: 'proof-1',
        state: 'done',
        threadId: 't-1',
        isVerified: true,
        createdAt: new Date(),
        metadata: { get: () => null },
      },
      previousState: 'presentation-received',
    })
    const presentation = (await delivered()).body
    expect(presentation.type).toBe('didcomm.presentations.state-updated')
    expect(presentation.data).toMatchObject({
      proofExchangeId: 'proof-1',
      state: 'done',
      verified: true,
      claims: [{ name: 'name', value: 'Alice' }],
      previousState: 'presentation-received',
    })

    fetchMock.mockClear()
    emit(DidCommCredentialEventTypes.DidCommCredentialStateChanged, {
      credentialExchangeRecord: {
        id: 'cred-1',
        state: 'offer-sent',
        threadId: 't-2',
        connectionId: 'conn-1',
        createdAt: new Date(),
        metadata: { get: () => ({ credentialDefinitionId: 'cd-1', schemaId: 's-1' }) },
      },
      previousState: null,
    })
    const exchange = (await delivered()).body
    expect(exchange.type).toBe('didcomm.credential-exchanges.state-updated')
    expect(exchange.data).toMatchObject({
      credentialExchangeId: 'cred-1',
      credentialDefinitionId: 'cd-1',
      schemaId: 's-1',
      claims: [{ name: 'name', value: 'Alice' }],
      previousState: null,
    })
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('delivers receipts and extension module messages from the processed message', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)
    const connection = { id: 'conn-1' }

    emit(DidCommEventTypes.DidCommMessageProcessed, {
      connection,
      message: {
        type: 'https://didcomm.org/receipts/1.0/message-receipts',
        threadId: 't-1',
        receipts: [{ messageId: 'm-1', state: 'viewed', timestamp: new Date('2026-09-01T00:00:00Z') }],
      },
    })
    const receipts = (await delivered()).body
    expect(receipts.type).toBe('didcomm.receipts.message-received')
    expect(receipts.data).toEqual({
      connectionId: 'conn-1',
      receipts: [{ messageId: 'm-1', state: 'viewed', timestamp: '2026-09-01T00:00:00.000Z' }],
    })

    fetchMock.mockClear()
    const plaintext = { '@type': 'https://didcomm.org/reactions/1.0/message-reactions', reactions: [] }
    emit(DidCommEventTypes.DidCommMessageProcessed, {
      connection,
      message: { type: plaintext['@type'], threadId: 't-2', toJSON: () => plaintext },
    })
    const reactions = (await delivered()).body
    expect(reactions.type).toBe('didcomm.reactions.message-received')
    expect(reactions.data).toEqual({ connectionId: 'conn-1', threadId: 't-2', message: plaintext })

    fetchMock.mockClear()
    emit(DidCommEventTypes.DidCommMessageProcessed, {
      connection,
      message: { type: 'https://didcomm.org/trust-ping/1.0/ping', threadId: 't-3', toJSON: () => ({}) },
    })
    emit(DidCommEventTypes.DidCommMessageProcessed, {
      message: { type: plaintext['@type'], threadId: 't-4', toJSON: () => plaintext },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('moves type and timestamp of a bus event into the envelope', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(VsAgentEventTypes.VtFlowStateUpdated, {
      event: new VtFlowStateUpdated({
        vtFlowRecordId: 'flow-1',
        threadId: 't-1',
        participantSessionId: 'ps-1',
        connectionId: 'conn-1',
        role: 'validator',
        variant: 'direct-issuance',
        state: 'validating',
        previousState: 'ir-received',
      }),
    })

    const { body } = await delivered()
    expect(body.type).toBe('vt.flows.state-updated')
    expect(body.data).toMatchObject({
      vtFlowRecordId: 'flow-1',
      state: 'validating',
      previousState: 'ir-received',
    })
    expect(body.data.type).toBeUndefined()
    expect(body.data.timestamp).toBeUndefined()
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
