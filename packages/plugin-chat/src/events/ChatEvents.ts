import type { ChatAgentModules } from '../types'
import type { MessageReceiptsReceivedEvent, MessageState } from '@2060.io/credo-ts-didcomm-receipts'
import type { VsAgentPluginConfig } from '@verana-labs/vs-agent-sdk'

import {
  CallAcceptMessage,
  CallEndMessage,
  CallOfferMessage,
  CallRejectMessage,
} from '@2060.io/credo-ts-didcomm-calls'
import {
  DidCommMediaSharingEventTypes,
  DidCommMediaSharingRole,
  DidCommMediaSharingState,
  DidCommMediaSharingStateChangedEvent,
} from '@2060.io/credo-ts-didcomm-media-sharing'
import {
  DidCommReactionsEventTypes,
  DidCommMessageReactionsReceivedEvent,
} from '@2060.io/credo-ts-didcomm-reactions'
import { ReceiptsEventTypes } from '@2060.io/credo-ts-didcomm-receipts'
import {
  DidCommConnectionProfileUpdatedEvent,
  DidCommProfileEventTypes,
  DidCommUserProfileRequestedEvent,
} from '@2060.io/credo-ts-didcomm-user-profile'
import { MenuRequestMessage, PerformMessage } from '@credo-ts/action-menu'
import { DidCommBasicMessage, DidCommEventTypes, DidCommMessageProcessedEvent } from '@credo-ts/didcomm'
import { AnswerMessage, QuestionAnswerService } from '@credo-ts/question-answer'
import {
  CallAcceptRequestMessage,
  CallEndRequestMessage,
  CallOfferRequestMessage,
  CallRejectRequestMessage,
  ContextualMenuRequestMessage,
  ContextualMenuSelectMessage,
  MediaMessage,
  MenuSelectMessage,
  MessageStateUpdated,
  ProfileMessage,
  ReactionMessage,
  TextMessage,
} from '@verana-labs/vs-agent-model'
import {
  createDataUrl,
  getRecordId,
  sendMessageReceivedEvent,
  sendWebhookEvent,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'

// FIXME: timestamps are currently taken from reception date. They should be get from the originating DIDComm message
// as soon as the corresponding extension is added to them
export const chatEvents = async (agent: VsAgent<ChatAgentModules>, config: VsAgentPluginConfig) => {
  agent.events.on(
    DidCommEventTypes.DidCommMessageProcessed,
    async ({ payload }: DidCommMessageProcessedEvent) => {
      config.logger.debug(`DidCommMessageProcessedEvent received: ${JSON.stringify(payload.message)}`)
      const { message, connection } = payload

      if (!connection) {
        config.logger.warn(
          `[chatEvents] Received contactless message of type ${message.type}. Not supported yet.`,
        )
        return
      }

      // Basic Message protocol messages
      if (message.type === DidCommBasicMessage.type.messageTypeUri) {
        const msg = new TextMessage({
          connectionId: connection.id,
          content: (payload.message as DidCommBasicMessage).content,
          id: payload.message.id,
          threadId: payload.message.thread?.parentThreadId,
          timestamp: new Date(),
        })

        if (msg.threadId) msg.threadId = await getRecordId(agent, msg.threadId)
        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      // Action Menu protocol messages
      if (message.type === MenuRequestMessage.type.messageTypeUri) {
        const msg = new ContextualMenuRequestMessage({
          connectionId: connection.id,
          id: connection.id,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      if (message.type === PerformMessage.type.messageTypeUri) {
        const msg = new ContextualMenuSelectMessage({
          selectionId: (message as PerformMessage).name,
          connectionId: connection.id,
          id: message.id,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      // Question Answer protocol messages
      if (message.type === AnswerMessage.type.messageTypeUri) {
        const record = await agent.dependencyManager
          .resolve(QuestionAnswerService)
          .getByThreadAndConnectionId(agent.context, connection.id, message.threadId)

        const textIdMapping = record.metadata.get<Record<string, string>>('text-id-mapping')

        if (!textIdMapping) {
          config.logger.warn(
            `[chatEvents] No text-id mapping found for Menu message. Using responded text as identifier`,
          )
        }
        const selectionId = textIdMapping
          ? textIdMapping[(message as AnswerMessage).response]
          : (message as AnswerMessage).response
        const msg = new MenuSelectMessage({
          threadId: message.threadId,
          connectionId: connection.id,
          menuItems: [{ id: selectionId }],
          id: message.id,
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      if (message.type === CallOfferMessage.type.messageTypeUri) {
        const callOffer = message as CallOfferMessage
        const msg = new CallOfferRequestMessage({
          id: await getRecordId(agent, message.id),
          connectionId: connection.id,
          offerExpirationTime: callOffer.offerExpirationTime ?? undefined,
          offerStartTime: callOffer.offerStartTime ?? undefined,
          description: callOffer.description,
          parameters: callOffer.parameters,
          threadId: message.thread?.threadId,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      if (message.type === CallEndMessage.type.messageTypeUri) {
        const thread = (message as CallEndMessage).thread
        const msg = new CallEndRequestMessage({
          id: await getRecordId(agent, message.id),
          connectionId: connection.id,
          threadId: thread?.threadId,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      if (message.type === CallAcceptMessage.type.messageTypeUri) {
        const parameters = (message as CallAcceptMessage).parameters
        const msg = new CallAcceptRequestMessage({
          id: await getRecordId(agent, message.id),
          connectionId: connection.id,
          parameters: parameters,
          threadId: message.thread?.threadId,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }

      if (message.type === CallRejectMessage.type.messageTypeUri) {
        const thread = (message as CallEndMessage).thread
        const msg = new CallRejectRequestMessage({
          id: await getRecordId(agent, message.id),
          connectionId: connection.id,
          threadId: thread?.threadId,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(msg, msg.timestamp, config)
      }
    },
  )

  // Media protocol events
  agent.events.on(
    DidCommMediaSharingEventTypes.StateChanged,
    async ({ payload }: DidCommMediaSharingStateChangedEvent) => {
      const record = payload.mediaSharingRecord

      config.logger.debug(
        `MediaSharingStateChangedEvent received. Role: ${record.role} Connection id: ${record.connectionId}. Items: ${JSON.stringify(record.items)}`,
      )

      if (
        record.state === DidCommMediaSharingState.MediaShared &&
        record.role === DidCommMediaSharingRole.Receiver
      ) {
        if (record.items) {
          const message = new MediaMessage({
            connectionId: record.connectionId!,
            id: record.threadId,
            threadId: record.parentThreadId,
            timestamp: record.createdAt,
            items: record.items?.map(item => ({
              id: item.id,
              ciphering: item.ciphering,
              uri: item.uri!,
              mimeType: item.mimeType,
              byteCount: item.byteCount,
              description: item.description,
              filename: item.fileName,
              duration: item.metadata?.duration as number,
              preview: item.metadata?.preview as string,
              width: item.metadata?.width as number,
              height: item.metadata?.height as number,
              title: item.metadata?.title as string,
              icon: item.metadata?.icon as string,
              openingMode: item.metadata?.openingMode as string,
              screenOrientation: item.metadata?.screenOrientation as string,
            })),
          })

          if (message.threadId) message.threadId = await getRecordId(agent, message.threadId)
          await sendMessageReceivedEvent(message, message.timestamp, config)
        }
      }
    },
  )

  // Receipts protocol events
  agent.events.on(
    ReceiptsEventTypes.MessageReceiptsReceived,
    async ({ payload }: MessageReceiptsReceivedEvent) => {
      const connectionId = payload.connectionId
      config.logger.debug(
        `MessageReceiptsReceivedEvent received. Connection id: ${connectionId}. Receipts: ${JSON.stringify(payload.receipts)}`,
      )
      const receipts = payload.receipts

      receipts.forEach(receipt => {
        const { messageId, timestamp, state } = receipt
        sendMessageStateUpdatedEvent({ agent, messageId, connectionId, state, timestamp, config })
      })
    },
  )

  // Reactions protocol events
  agent.events.on(
    DidCommReactionsEventTypes.DidCommMessageReactionsReceived,
    async ({ payload }: DidCommMessageReactionsReceivedEvent) => {
      const { connectionId, reactions } = payload
      config.logger.debug(
        `DidCommMessageReactionsReceivedEvent received. Connection id: ${connectionId}. Reactions: ${JSON.stringify(reactions)}`,
      )

      const msg = new ReactionMessage({
        connectionId,
        reactions: reactions.map(r => ({
          messageId: r.messageId,
          emoji: r.emoji,
          action: r.action,
          timestamp: r.timestamp,
        })),
      })

      await sendMessageReceivedEvent(msg, msg.timestamp, config)
    },
  )

  // User profile events
  agent.events.on(
    DidCommProfileEventTypes.UserProfileRequested,
    async ({ payload }: DidCommUserProfileRequestedEvent) => {
      config.logger.debug(
        `UserProfileRequestedEvent received. Connection id: ${payload.connection.id} Query: ${JSON.stringify(payload.query)}`,
      )

      const outOfBandRecordId = payload.connection.outOfBandId
      if (outOfBandRecordId) {
        const outOfBandRecord = await agent.didcomm.oob.findById(outOfBandRecordId)
        const parentConnectionId = outOfBandRecord?.getTag('parentConnectionId') as string | undefined
        if (!parentConnectionId && agent.autoDiscloseUserProfile)
          await agent.modules.userProfile.sendUserProfile({ connectionId: payload.connection.id })
      }
    },
  )

  agent.events.on(
    DidCommProfileEventTypes.ConnectionProfileUpdated,
    async ({ payload: { connection, profile } }: DidCommConnectionProfileUpdatedEvent) => {
      const { displayName, displayPicture, displayIcon, description, preferredLanguage } = profile
      config.logger.debug(
        `ConnectionProfileUpdatedEvent received. Connection id: ${connection.id} Profile: ${JSON.stringify(profile)}`,
      )

      const msg = new ProfileMessage({
        connectionId: connection.id,
        displayName,
        displayImageUrl: displayPicture && createDataUrl(displayPicture),
        displayIconUrl: displayIcon && createDataUrl(displayIcon),
        description,
        preferredLanguage,
      })

      await sendMessageReceivedEvent(msg, msg.timestamp, config)
    },
  )
}

const sendMessageStateUpdatedEvent = async (options: {
  agent: VsAgent<ChatAgentModules>
  messageId: string
  connectionId: string
  state: MessageState
  timestamp: Date
  config: VsAgentPluginConfig
}) => {
  const { agent, messageId, connectionId, state, timestamp, config } = options
  const body = new MessageStateUpdated({
    messageId: await getRecordId(agent, messageId),
    state,
    timestamp,
    connectionId,
  })
  await sendWebhookEvent(config.webhookUrl + '/message-state-updated', body, config.logger)
}
