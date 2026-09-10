import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  DidCommMediaSharingEventTypes,
  DidCommMediaSharingRole,
  DidCommMediaSharingState,
  DidCommMediaSharingStateChangedEvent,
} from '@2060.io/credo-ts-didcomm-media-sharing'
import {
  DidCommConnectionProfileUpdatedEvent,
  DidCommProfileEventTypes,
} from '@2060.io/credo-ts-didcomm-user-profile'

import { moduleOf } from './didcommModules'

type Message = Record<string, any>

type Deliver = (type: string, data: unknown) => void

const MIDDLEWARE_MODULES = new Set([
  'receipts',
  'reactions',
  'user-profile',
  'media-sharing',
  'calls',
  'action-menu',
  'question-answer',
])

const CATALOG: Record<string, (message: Message, connectionId: string) => Record<string, unknown>> = {
  'https://didcomm.org/receipts/1.0/message-receipts': (message, connectionId) => ({
    connectionId,
    receipts: message.receipts?.map(({ messageId, state, timestamp }: Message) => ({
      messageId,
      state,
      timestamp,
    })),
  }),
  'https://didcomm.org/reactions/1.0/message-reactions': (message, connectionId) => ({
    connectionId,
    reactions: message.reactions?.map(({ messageId, emoji, action, timestamp }: Message) => ({
      messageId,
      emoji,
      action,
      timestamp,
    })),
  }),
  'https://didcomm.org/user-profile/1.0/request-profile': (message, connectionId) => ({
    connectionId,
    threadId: message.threadId,
    query: message.query,
  }),
  'https://didcomm.org/media-sharing/1.0/request-media': (message, connectionId) => ({
    connectionId,
    threadId: message.threadId,
    description: message.description,
    itemIds: message.itemIds,
  }),
  'https://didcomm.org/calls/1.0/call-offer': (message, connectionId) => ({
    connectionId,
    threadId: message.threadId,
    callType: message.callType,
    parameters: message.parameters,
    description: message.description,
    offerStartTime: message.offerStartTime,
    offerExpirationTime: message.offerExpirationTime,
  }),
  'https://didcomm.org/calls/1.0/call-accept': (message, connectionId) => ({
    connectionId,
    threadId: message.threadId,
    parameters: message.parameters,
  }),
  'https://didcomm.org/calls/1.0/call-reject': threadOnly,
  'https://didcomm.org/calls/1.0/call-end': threadOnly,
  'https://didcomm.org/action-menu/1.0/menu-request': threadOnly,
  'https://didcomm.org/action-menu/1.0/perform': (message, connectionId) => ({
    connectionId,
    threadId: message.threadId,
    name: message.name,
    params: message.params,
  }),
  'https://didcomm.org/questionanswer/1.0/answer': (message, connectionId) => ({
    connectionId,
    threadId: message.threadId,
    response: message.response,
  }),
}

const FROM_MODULE_EVENT = new Set([
  'https://didcomm.org/media-sharing/1.0/share-media',
  'https://didcomm.org/user-profile/1.0/profile',
])

export function registerDidcommModuleEvents(agent: VsAgent, deliver: Deliver): void {
  agent.didcomm.registerMessageHandlerMiddleware(async (context, next) => {
    await next()
    const { message, connection } = context
    if (!connection) return

    const module = moduleOf(protocolOf(message.type))
    if (!module || !MIDDLEWARE_MODULES.has(module) || FROM_MODULE_EVENT.has(message.type)) return

    const data = CATALOG[message.type]?.(message as Message, connection.id) ?? {
      connectionId: connection.id,
      threadId: message.threadId,
      message: message.toJSON(),
    }
    deliver(`didcomm.${module}.${messageNameOf(message.type)}-received`, data)
  })

  agent.events.on<DidCommConnectionProfileUpdatedEvent>(
    DidCommProfileEventTypes.ConnectionProfileUpdated,
    ({ payload }) => {
      deliver('didcomm.user-profile.profile-received', {
        connectionId: payload.connection.id,
        threadId: payload.threadId,
        profile: payload.profile,
        sendBackYours: payload.sendBackYoursRequested ?? false,
      })
    },
  )

  agent.events.on<DidCommMediaSharingStateChangedEvent>(
    DidCommMediaSharingEventTypes.StateChanged,
    ({ payload: { mediaSharingRecord: record } }) => {
      if (record.role !== DidCommMediaSharingRole.Receiver) return
      if (record.state !== DidCommMediaSharingState.MediaShared) return

      deliver('didcomm.media-sharing.share-media-received', {
        connectionId: record.connectionId,
        threadId: record.threadId,
        description: record.description,
        items: record.items,
      })
    },
  )
}

function threadOnly(message: Message, connectionId: string): Record<string, unknown> {
  return { connectionId, threadId: message.threadId }
}

const protocolOf = (messageType: string): string => messageType.slice(0, messageType.lastIndexOf('/'))

const messageNameOf = (messageType: string): string => messageType.slice(messageType.lastIndexOf('/') + 1)
