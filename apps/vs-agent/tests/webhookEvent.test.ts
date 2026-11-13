import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRole,
  DidCommConnectionEventTypes,
  DidCommDiscoverFeaturesEventTypes,
  DidCommProofEventTypes,
  DidCommProtocol,
} from '@credo-ts/didcomm'
import { InvitationRecord, InvitationRepository } from '@verana-labs/vs-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { webhookEvent } from '../src/utils/webhookEvent'

type Handler = (event: { payload: unknown }) => unknown

const URL = 'https://backend.example/events'
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const fetchMock = vi.fn()

const invitationRepository = { getById: vi.fn() }

function fakeAgent(discoveryOptions?: { featureType: string; match: string }[]) {
  const handlers = new Map<string, Handler>()
  const agent = {
    context: {},
    discoveryOptions,
    dependencyManager: {
      resolve: (token: unknown) => (token === InvitationRepository ? invitationRepository : undefined),
    },
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
  return {
    agent,
    emit: (type: string, payload: unknown) => handlers.get(type)?.({ payload }),
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
  getTag: () => undefined,
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
    expect(body.data).toMatchObject({
      id: 'conn-1',
      state: 'completed',
      previousState: null,
      invitationId: null,
      parentConnectionId: null,
    })
  })

  it('delivers a sub-connection with its invitationId and parentConnectionId', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, {
      connectionRecord: {
        ...connectionRecord,
        outOfBandId: 'oob-1',
        getTag: (name: string) => ({ parentConnectionId: 'conn-0', invitationId: 'oob-1' })[name],
      },
      previousState: null,
    })

    const { body } = await delivered()
    expect(body.type).toBe('didcomm.connections.state-updated')
    expect(body.data).toMatchObject({ id: 'conn-1', invitationId: 'oob-1', parentConnectionId: 'conn-0' })
  })

  it('announces a coming disclosure with an empty metadata on a completed connection when discovery is on', async () => {
    const { agent, emit } = fakeAgent([{ featureType: 'protocol', match: '*' }])
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, { connectionRecord, previousState: null })

    const { body } = await delivered()
    expect(body.data).toMatchObject({ id: 'conn-1', state: 'completed', metadata: {} })
  })

  it('carries no metadata without discovery, nor on a connection that is not completed', async () => {
    const off = fakeAgent()
    webhookEvent(off.agent as never, { url: URL }, logger as never)
    off.emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, {
      connectionRecord,
      previousState: null,
    })
    expect((await delivered()).body.data).not.toHaveProperty('metadata')

    fetchMock.mockClear()
    const on = fakeAgent([{ featureType: 'protocol', match: '*' }])
    webhookEvent(on.agent as never, { url: URL }, logger as never)
    on.emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, {
      connectionRecord: { ...connectionRecord, state: 'response-sent' },
      previousState: 'request-received',
    })
    expect((await delivered()).body.data).not.toHaveProperty('metadata')
  })

  it('delivers a disclosure as a connection event in state updated, each feature id mapped to its JSON', async () => {
    const { agent, emit } = fakeAgent([{ featureType: 'protocol', match: '*' }])
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit(DidCommDiscoverFeaturesEventTypes.DisclosureReceived, {
      connection: connectionRecord,
      disclosures: [
        new DidCommProtocol({ id: 'https://didcomm.org/ayni-flow/1.0', roles: ['holder'] }),
        new DidCommProtocol({ id: 'https://didcomm.org/link-session/1.0' }),
      ],
      protocolVersion: 'v2',
      threadId: 'thread-1',
    })

    const { body } = await delivered()
    expect(body.type).toBe('didcomm.connections.state-updated')
    expect(body.data).toMatchObject({ id: 'conn-1', state: 'updated', previousState: 'completed' })
    expect(Object.keys(body.data.metadata)).toEqual([
      'https://didcomm.org/ayni-flow/1.0',
      'https://didcomm.org/link-session/1.0',
    ])
    expect(JSON.parse(body.data.metadata['https://didcomm.org/ayni-flow/1.0'])).toEqual({
      'feature-type': 'protocol',
      id: 'https://didcomm.org/ayni-flow/1.0',
      roles: ['holder'],
    })
  })

  it('delivers an invitation record, read back from the store, with its previousState', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)
    const record = new InvitationRecord({
      id: 'inv-1',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      state: 'created',
      didcommVersion: 'v2',
      reusable: true,
      invitation: { type: 'https://didcomm.org/out-of-band/2.0/invitation', id: 'oob-msg-1' },
      shortUrl: 'https://agent.example/s?id=abcd',
      parentConnectionId: null,
    })
    invitationRepository.getById.mockResolvedValueOnce(record)

    emit('vs-agent-invitation-state-updated', {
      event: { invitationRecordId: 'inv-1', state: 'created', previousState: null },
    })

    const { body } = await delivered()
    expect(invitationRepository.getById).toHaveBeenCalledWith(agent.context, 'inv-1')
    expect(body.type).toBe('didcomm.invitations.state-updated')
    expect(body.data).toEqual({
      id: 'inv-1',
      state: 'created',
      didcommVersion: 'v2',
      reusable: true,
      invitation: { type: 'https://didcomm.org/out-of-band/2.0/invitation', id: 'oob-msg-1' },
      shortUrl: 'https://agent.example/s?id=abcd',
      parentConnectionId: null,
      acceptances: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
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

  it('delivers a module message event as its own envelope', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit('vs-agent-module-message-received', {
      type: 'didcomm.receipts.message-receipts-received',
      data: { connectionId: 'conn-1', receipts: [{ messageId: 'm-1', state: 'viewed' }] },
    })

    const { body } = await delivered()
    expect(body.type).toBe('didcomm.receipts.message-receipts-received')
    expect(body.data).toEqual({
      connectionId: 'conn-1',
      receipts: [{ messageId: 'm-1', state: 'viewed' }],
    })
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

  it('waits for the trust decision before it delivers a presentation-received change', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    const received = {
      id: 'proof-1',
      state: 'presentation-received',
      role: 'verifier',
      isVerified: true,
      createdAt: new Date(),
    }
    const presented = {
      group: 'employee',
      credentialDefinitionId: 'did:webvh:issuer-a/resources/cred-def-a',
      issuerDid: 'did:webvh:issuer-a',
      credentialSchemaId: 12,
      ecosystemDid: 'did:webvh:ecosystem',
      jsonSchemaCredentialId: 'https://ecosystem.example/vt/schemas-employee-jsc.json',
    }

    const decided = {
      ...received,
      metadata: { get: (key: string) => (key === '_2060/presentedCredentials' ? [presented] : null) },
    }

    // Credo emits this change. The agent does not deliver it, whatever the record holds.
    await emit(DidCommProofEventTypes.ProofStateChanged, {
      proofRecord: { ...received, metadata: { get: () => null } },
      previousState: 'request-sent',
    })
    await emit(DidCommProofEventTypes.ProofStateChanged, {
      proofRecord: decided,
      previousState: 'request-sent',
    })
    expect(fetchMock).not.toHaveBeenCalled()

    // The trust decision emits this event, with the credentials that it recorded
    emit('vs-agent-presentation-trust-decided', {
      proofRecord: decided,
      previousState: 'request-sent',
    })

    const { body } = await delivered()
    expect(body.data).toMatchObject({
      state: 'presentation-received',
      verified: true,
      previousState: 'request-sent',
      credentials: [{ issuerDid: 'did:webvh:issuer-a', credentialSchemaId: 12, unrevealed: [] }],
    })
    expect(body.data.credentials[0]).not.toHaveProperty('group')
  })

  it('delivers presentation-received with the cause when the trust decision fails', async () => {
    const { agent, emit } = fakeAgent()
    webhookEvent(agent as never, { url: URL }, logger as never)

    emit('vs-agent-presentation-trust-decided', {
      proofRecord: {
        id: 'proof-1',
        state: 'presentation-received',
        role: 'verifier',
        isVerified: false,
        errorMessage: 'e.p.issuer-not-authorized: did:webvh:issuer-c holds no active ISSUER Participant',
        createdAt: new Date(),
        metadata: {
          get: (key: string) =>
            key === '_2060/rejectedCredentials'
              ? [{ index: 0, code: 'e.p.issuer-not-authorized', note: 'n', issuerDid: 'did:webvh:issuer-c' }]
              : null,
        },
      },
      previousState: 'request-sent',
    })

    const { body } = await delivered()
    expect(body.type).toBe('didcomm.presentations.state-updated')
    expect(body.data).toMatchObject({
      state: 'presentation-received',
      verified: false,
      credentials: [],
      rejectedCredentials: [{ index: 0, code: 'e.p.issuer-not-authorized', issuerDid: 'did:webvh:issuer-c' }],
      errorMessage: 'e.p.issuer-not-authorized: did:webvh:issuer-c holds no active ISSUER Participant',
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
