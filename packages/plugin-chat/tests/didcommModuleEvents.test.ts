import { describe, expect, it } from 'vitest'

import { registerDidcommModuleEvents } from '../src/events/didcommModuleEvents'
import { ChatPlugin } from '../src/nestjs/ChatPlugin'

type Handler = (event: { payload: unknown }) => unknown
type Middleware = (context: unknown, next: () => Promise<void>) => Promise<void>
type Emitted = { type: string; data: Record<string, unknown> }

function fakeAgent(register: (agent: unknown) => void = registerDidcommModuleEvents as never) {
  const handlers = new Map<string, Handler>()
  const middlewares: Middleware[] = []
  const emitted: Emitted[] = []
  const agent = {
    context: {},
    events: {
      on: (type: string, handler: Handler) => handlers.set(type, handler),
      emit: (_context: unknown, event: { payload: Emitted }) => emitted.push(event.payload),
    },
    didcomm: {
      registerMessageHandlerMiddleware: (middleware: Middleware) => middlewares.push(middleware),
    },
  }
  register(agent)
  return {
    emitted,
    emit: (type: string, payload: unknown) => handlers.get(type)?.({ payload }),
    process: (context: unknown) => middlewares[0](context, async () => {}),
  }
}

const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('chat module events', () => {
  it('emits a module event for every chat protocol message the handler processed', async () => {
    const { emitted, process } = fakeAgent()
    const connection = { id: 'conn-1' }

    await process({
      connection,
      message: {
        type: 'https://didcomm.org/receipts/1.0/message-receipts',
        threadId: 't-1',
        receipts: [{ messageId: 'm-1', state: 'viewed', timestamp: new Date('2026-09-01T00:00:00Z') }],
      },
    })
    await process({
      connection,
      message: {
        type: 'https://didcomm.org/reactions/1.0/message-reactions',
        threadId: 't-2',
        reactions: [{ messageId: 'm-1', emoji: '\u{1F44D}', action: 'react', timestamp: new Date(0) }],
      },
    })
    await process({
      connection,
      message: {
        type: 'https://didcomm.org/calls/1.0/call-offer',
        threadId: 't-3',
        callType: 'video',
        parameters: { wsUrl: 'wss://calls.example' },
      },
    })

    expect(emitted.map(event => event.type)).toEqual([
      'didcomm.receipts.message-receipts-received',
      'didcomm.reactions.message-reactions-received',
      'didcomm.calls.call-offer-received',
    ])
    expect(asJson(emitted[0].data)).toEqual({
      connectionId: 'conn-1',
      receipts: [{ messageId: 'm-1', state: 'viewed', timestamp: '2026-09-01T00:00:00.000Z' }],
    })
    expect(asJson(emitted[1].data)).toEqual({
      connectionId: 'conn-1',
      reactions: [
        { messageId: 'm-1', emoji: '\u{1F44D}', action: 'react', timestamp: '1970-01-01T00:00:00.000Z' },
      ],
    })
    expect(emitted[2].data).toEqual({
      connectionId: 'conn-1',
      threadId: 't-3',
      callType: 'video',
      parameters: { wsUrl: 'wss://calls.example' },
    })
  })

  it('emits nothing for a protocol of another module or a message without a connection', async () => {
    const { emitted, process } = fakeAgent()

    await process({
      connection: { id: 'conn-1' },
      message: { type: 'https://didcomm.org/trust-ping/1.0/ping', threadId: 't-4', toJSON: () => ({}) },
    })
    await process({
      message: { type: 'https://didcomm.org/reactions/1.0/message-reactions', threadId: 't-5' },
    })

    expect(emitted).toHaveLength(0)
  })

  it('leaves profile and share-media to their module events, so the middleware emits nothing', async () => {
    const { emitted, process } = fakeAgent()
    const connection = { id: 'conn-1' }

    await process({
      connection,
      message: {
        type: 'https://didcomm.org/user-profile/1.0/profile',
        threadId: 't-9',
        profile: { displayName: 'Alice', displayPicture: '#displayPicture' },
        toJSON: () => ({}),
      },
    })
    await process({
      connection,
      message: {
        type: 'https://didcomm.org/media-sharing/1.0/share-media',
        threadId: 't-10',
        toJSON: () => ({}),
      },
    })

    expect(emitted).toHaveLength(0)
  })

  it('emits a received profile from the module event, with the picture resolved', () => {
    const { emitted, emit } = fakeAgent()

    emit('DidCommConnectionProfileUpdated', {
      connection: { id: 'conn-1' },
      threadId: 't-9',
      sendBackYoursRequested: true,
      profile: {
        displayName: 'Alice',
        displayPicture: { mimeType: 'image/png', links: ['https://pics.example/a.png'] },
      },
    })

    expect(emitted).toEqual([
      {
        type: 'didcomm.user-profile.profile-received',
        data: {
          connectionId: 'conn-1',
          threadId: 't-9',
          sendBackYours: true,
          profile: {
            displayName: 'Alice',
            displayPicture: { mimeType: 'image/png', links: ['https://pics.example/a.png'] },
          },
        },
      },
    ])
  })

  it('emits a shared media record with the thread id of an unsolicited share', () => {
    const { emitted, emit } = fakeAgent()

    emit('DidCommMediaSharingStateChangedEvent', {
      mediaSharingRecord: {
        connectionId: 'conn-1',
        role: 'receiver',
        state: 'media-shared',
        threadId: 'share-thread-1',
        parentThreadId: undefined,
        description: 'a photo',
        items: [{ id: 'i-1', uri: 'https://media.example/1', mimeType: 'image/png' }],
      },
    })

    expect(emitted).toEqual([
      {
        type: 'didcomm.media-sharing.share-media-received',
        data: {
          connectionId: 'conn-1',
          threadId: 'share-thread-1',
          description: 'a photo',
          items: [{ id: 'i-1', uri: 'https://media.example/1', mimeType: 'image/png' }],
        },
      },
    ])
  })

  it('registers the middleware through the plugin, so a deployment that serves chat delivers its events', async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    const { emitted, process } = fakeAgent(agent =>
      ChatPlugin().registerEvents?.(agent as never, logger as never),
    )

    await process({
      connection: { id: 'conn-1' },
      message: { type: 'https://didcomm.org/receipts/1.0/message-receipts', receipts: [] },
    })

    expect(emitted.map(event => event.type)).toEqual(['didcomm.receipts.message-receipts-received'])
  })
})
