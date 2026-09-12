import type { INestApplication } from '@nestjs/common'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import '@hyperledger/anoncreds-nodejs'

import { BaseLogger } from '@credo-ts/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Subject } from 'rxjs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'
import { PublicModule } from '../src/public.module'
import { webhookEvent } from '../src/utils'

import { startAgent } from './__mocks__'
import { FakeDidResolver } from './__mocks__/fakeDidResolver'
import {
  makeConnection,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  type SubjectMessage,
} from './helpers'

const PUBLIC_API_BASE_URL = 'http://localhost:3001'
const HOOK = 'http://events.test/hook'
const MESSAGE_RECEIVED = 'didcomm.basic-messages.message-received'

async function startAdminApi(agent: VsAgent<BaseAgentModules>): Promise<INestApplication> {
  const [chat, mrtd] = await Promise.all([
    import('@verana-labs/vs-agent-plugin-chat').catch(() => null),
    import('@verana-labs/vs-agent-plugin-mrtd').catch(() => null),
  ])
  const plugins = [...(chat ? [chat.ChatPlugin()] : []), ...(mrtd ? [mrtd.MrtdPlugin()] : [])]
  const moduleRef = await Test.createTestingModule({
    imports: [
      VsAgentModule.register(agent, PUBLIC_API_BASE_URL, plugins),
      PublicModule.register(agent, PUBLIC_API_BASE_URL),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(new ValidationPipe())
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  await app.init()

  return app
}

type Envelope = { type: string; data: Record<string, unknown> }

const realFetch = globalThis.fetch
const fetchMock = vi.fn((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
  String(url) === HOOK ? Promise.resolve({ ok: true, status: 200 } as Response) : realFetch(url, init),
)

function envelopes(type: string): Envelope[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url) === HOOK)
    .map(([, init]) => JSON.parse(String(init?.body)) as Envelope)
    .filter(envelope => envelope.type === type)
}

async function deliveredAfter(before: number): Promise<Envelope> {
  await vi.waitFor(() => expect(envelopes(MESSAGE_RECEIVED).length).toBeGreaterThan(before), {
    timeout: 10_000,
  })
  return envelopes(MESSAGE_RECEIVED)[before]
}

const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('v2 didcomm basic messages, over two agents', () => {
  let faberAgent: VsAgent<BaseAgentModules>
  let aliceAgent: VsAgent<BaseAgentModules>
  let faberApp: INestApplication
  let aliceApp: INestApplication
  let faberConnectionId: string
  let aliceConnectionId: string

  const faberMessages = new Subject<SubjectMessage>()
  const aliceMessages = new Subject<SubjectMessage>()
  const subjectMap = { 'rxjs:faber': faberMessages, 'rxjs:alice': aliceMessages }
  const resolver = new FakeDidResolver()

  const faber = () => request(faberApp.getHttpServer())
  const alice = () => request(aliceApp.getHttpServer())

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock)

    faberAgent = await startAgent({ label: 'Faber', domain: 'faber' })
    faberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
    faberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    faberAgent.dids.config.resolvers.unshift(resolver)
    await faberAgent.initialize()
    faberApp = await startAdminApi(faberAgent)

    aliceAgent = await startAgent({ label: 'Alice', domain: 'alice' })
    aliceAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(aliceMessages))
    aliceAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    aliceAgent.dids.config.resolvers.unshift(resolver)
    await aliceAgent.initialize()
    aliceApp = await startAdminApi(aliceAgent)

    await resolver.registerAgent(faberAgent)
    await resolver.registerAgent(aliceAgent)

    webhookEvent(faberAgent, { url: HOOK }, faberAgent.config.logger as BaseLogger)
    webhookEvent(aliceAgent, { url: HOOK }, aliceAgent.config.logger as BaseLogger)

    const [faberConnection, aliceConnection] = await makeConnection(faberAgent, aliceAgent)
    faberConnectionId = faberConnection.id
    aliceConnectionId = aliceConnection.id
  }, 120_000)

  afterAll(async () => {
    await faberApp?.close()
    await aliceApp?.close()
    await faberAgent?.shutdown()
    await aliceAgent?.shutdown()
    vi.unstubAllGlobals()
  })

  it('sends a message that the peer receives, and both sides list the same record the event carried', async () => {
    const before = envelopes(MESSAGE_RECEIVED).length
    const sent = await faber()
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: faberConnectionId, content: 'hello alice' })

    expect(sent.status).toBe(201)
    expect(typeof sent.body.id).toBe('string')

    const event = await deliveredAfter(before)
    expect(event.data).toMatchObject({
      connectionId: aliceConnectionId,
      role: 'receiver',
      content: 'hello alice',
    })

    const received = await alice().get(
      `/v2/didcomm/basic-messages?role=receiver&connectionId=${aliceConnectionId}`,
    )
    expect(received.status).toBe(200)
    expect(received.body.items).toHaveLength(1)
    expect(received.body.items[0]).toEqual(asJson(event.data))
    expect(received.body.nextCursor).toBeNull()

    const outgoing = await faber().get(
      `/v2/didcomm/basic-messages?role=sender&connectionId=${faberConnectionId}`,
    )
    expect(outgoing.status).toBe(200)
    expect(outgoing.body.items).toHaveLength(1)
    expect(outgoing.body.items[0]).toMatchObject({ id: sent.body.id, role: 'sender', content: 'hello alice' })

    expect(envelopes(MESSAGE_RECEIVED)).toHaveLength(before + 1)
  }, 15_000)

  it('carries a reply back the other way', async () => {
    const before = envelopes(MESSAGE_RECEIVED).length
    const reply = await alice()
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: aliceConnectionId, content: 'hello faber' })
    expect(reply.status).toBe(201)

    const event = await deliveredAfter(before)
    expect(event.data).toMatchObject({
      connectionId: faberConnectionId,
      role: 'receiver',
      content: 'hello faber',
    })

    const inbox = await faber().get(`/v2/didcomm/basic-messages?role=receiver`)
    expect(inbox.body.items.map((item: { content: string }) => item.content)).toEqual(['hello faber'])
    expect(envelopes(MESSAGE_RECEIVED)).toHaveLength(before + 1)
  }, 15_000)

  it('lists both directions when the caller sets no role', async () => {
    const all = await faber().get(`/v2/didcomm/basic-messages?connectionId=${faberConnectionId}`)

    expect(all.status).toBe(200)
    expect(
      all.body.items.map((item: { role: string; content: string }) => [item.role, item.content]),
    ).toEqual([
      ['sender', 'hello alice'],
      ['receiver', 'hello faber'],
    ])
  })

  it('reports an unknown connection as UNKNOWN_ID before anything leaves the agent', async () => {
    const before = envelopes(MESSAGE_RECEIVED).length

    const response = await faber()
      .post('/v2/didcomm/basic-messages')
      .send({ connectionId: 'nope', content: 'x' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('UNKNOWN_ID')
    expect(envelopes(MESSAGE_RECEIVED)).toHaveLength(before)
  })

  it('lists the modules this deployment serves, from what the agent registered', async () => {
    const response = await faber().get('/v2/didcomm/protocols')

    expect(response.status).toBe(200)
    const modules = Object.fromEntries(
      response.body.map((entry: { module: string; protocols: string[] }) => [entry.module, entry.protocols]),
    )
    expect(modules['basic-messages']).toEqual([
      'https://didcomm.org/basicmessage/1.0',
      'https://didcomm.org/basicmessage/2.0',
    ])
    expect(modules.receipts).toEqual(['https://didcomm.org/receipts/1.0'])
    expect(modules.mrtd).toEqual(['https://didcomm.org/mrtd/1.0'])
    expect(modules).not.toHaveProperty('invitations')
    expect(Object.keys(modules)).toEqual([
      'connections',
      'basic-messages',
      'presentations',
      'credential-exchanges',
      'receipts',
      'reactions',
      'user-profile',
      'media-sharing',
      'calls',
      'action-menu',
      'question-answer',
      'mrtd',
    ])
  })
})
