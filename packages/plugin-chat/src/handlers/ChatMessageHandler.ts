import type { MessageHandler } from '@verana-labs/vs-agent-sdk'

import { ActionMenuOption, ActionMenuRole } from '@credo-ts/action-menu'
import { JsonTransformer } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { QuestionAnswerRepository, ValidResponse } from '@credo-ts/question-answer'
import { Injectable } from '@nestjs/common'
import {
  CallEndRequestMessage,
  CallOfferRequestMessage,
  ContextualMenuUpdateMessage,
  IBaseMessage,
  MediaMessage,
  MenuDisplayMessage,
  MessageType,
  ProfileMessage,
  ReactionMessage,
  ReceiptsMessage,
  TextMessage,
} from '@verana-labs/vs-agent-model'
import { didcommReceiptFromVsAgentReceipt, parsePictureData, VsAgent } from '@verana-labs/vs-agent-sdk'

@Injectable()
export class ChatMessageHandler implements MessageHandler {
  readonly supportedTypes: MessageType[] = [
    MessageType.TextMessage,
    MessageType.MediaMessage,
    MessageType.ReceiptsMessage,
    MessageType.ReactionMessage,
    MessageType.MenuDisplayMessage,
    MessageType.ContextualMenuUpdateMessage,
    MessageType.ProfileMessage,
    MessageType.CallOfferRequestMessage,
    MessageType.CallEndRequestMessage,
  ]

  readonly openApiExamples: Record<string, { summary: string; description: string; value: object }> = {
    callAccept: {
      summary: 'Call Accept',
      description:
        '#### Call Accept\n\nAccept a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to track the subsequent status of the call. Additional parameters related to the `wsUrl` of the WebRTC server connection are expected to notify the other party.',
      value: { type: 'call-accept', parameters: { key: 'value' } },
    },
    callReject: {
      summary: 'Call Reject',
      description:
        '#### Call Reject\n\nReject a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to identify which offer has been terminated.',
      value: { type: 'call-reject' },
    },
    callEnd: {
      summary: 'Call End',
      description:
        '#### Call End\n\nEnd a call offer from a third party to initiate a WebRTC call. This message will return a `threadId`, which can be used to identify which offer has been terminated.',
      value: { type: 'call-end' },
    },
    callOffer: {
      summary: 'Call Offer',
      description:
        '#### Call Offer\n\nCreate a call offer from a service to initiate a WebRTC call and notify the other party of the created request. This message will return a `threadId`, which can be used to track the subsequent status of the call. Additional parameters related to the `wsUrl` of the WebRTC server connection are expected to notify the other party.',
      value: { type: 'call-offer', parameters: { key: 'value' } },
    },
    contextualMenuRequest: {
      summary: 'Contextual Menu Request',
      description:
        '#### Contextual Menu Request\n\nRequests a destination agent context menu root (if any). The other side should always respond with a [Context Menu Update](#contextual-menu-update) even if no context menu is available (in such case, an empty payload will be sent).',
      value: { type: 'contextual-menu-request' },
    },
    contextualMenuSelect: {
      summary: 'Contextual Menu Select',
      description: '#### Contextual Menu Select\n\nSubmits the selected item of context menu.',
      value: { type: 'contextual-menu-select', selectionId: 'string' },
    },
    contextualMenuUpdate: {
      summary: 'Contextual Menu Update',
      description:
        '#### Contextual Menu Update\n\nSends or updates the contents for the contextual menu to destination agent.',
      value: {
        type: 'contextual-menu-update',
        payload: {
          title: 'string',
          description: 'string',
          options: [{ id: 'string', title: 'string', description: 'string' }],
        },
      },
    },
    media: {
      summary: 'Media',
      description:
        '#### Media\n\nShares media files to a destination. They might be previously encrypted and stored in an URL reachable by the destination agent.',
      value: {
        type: 'media',
        description: 'string',
        items: [
          {
            mimeType: 'string',
            filename: 'string',
            description: 'string',
            byteCount: 'number',
            uri: 'string',
            ciphering: { algorithm: 'string' },
            preview: 'string',
            width: 'number',
            height: 'number',
            duration: 'number',
            title: 'string',
            icon: 'string',
            openingMode: 'string',
            screenOrientaton: 'string',
          },
        ],
      },
    },
    menuDisplay: {
      summary: 'Menu Display',
      description: 'Menu Display\n\nAuto-generated example .',
      value: {
        type: 'menu-display',
        connectionId: 'REPLACE_WITH_CONNECTION_ID',
        timestamp: '2025-08-19T16:17:08.871Z',
      },
    },
    menuSelect: {
      summary: 'Menu Select',
      description:
        '#### Menu Select\n\nSubmits the selected item of a presented menu, defined in `threadId` field.',
      value: { type: 'menu-select', menuItems: [{ id: 'string' }], content: 'string' },
    },
    profile: {
      summary: 'Profile',
      description:
        '#### Profile\n\nSends User Profile to a particular connection. An Agent may have its default profile settings, but also override them and send any arbitrary value to each connection. All items are optional.\n\n> **Notes**:\n\n- Display Image and Contextual Menu Image are sent as a Data URL or regular URL\n- A null value means to delete any existing one. A missing value means to keep the previous one.',
      value: { type: 'profile', displayName: 'string', displayImageUrl: 'string', displayIconUrl: 'string' },
    },
    reaction: {
      summary: 'Reaction',
      description:
        '#### Reaction\n\nSends emoji reactions to previously received messages. Each reaction references a `message_id` and an `emoji`. Use `action: "react"` to add a reaction or `action: "unreact"` to remove it.',
      value: {
        type: 'reaction',
        reactions: [{ message_id: 'uuid-of-original-message', emoji: '👍', action: 'react' }],
      },
    },
    receipts: {
      summary: 'Receipts',
      description: '#### Receipts\n\nSends message updates for a number of messages.',
      value: {
        type: 'receipts',
        receipts: [{ messageId: 'string', state: 'MessageState', timestamp: 'Date' }],
      },
    },
    text: {
      summary: 'Text',
      description: '#### Text\n\nSends a simple text to a destination',
      value: { type: 'text', content: 'string' },
    },
  }

  async handle(
    agent: VsAgent<any>,
    message: IBaseMessage,
    connection: DidCommConnectionRecord,
  ): Promise<string | undefined> {
    const messageType = message.type
    let messageId: string | undefined

    if (messageType === TextMessage.type) {
      const textMsg = JsonTransformer.fromJSON(message, TextMessage)
      const record = await agent.didcomm.basicMessages.sendMessage(textMsg.connectionId, textMsg.content)
      messageId = record.threadId
    } else if (messageType === MediaMessage.type) {
      const mediaMsg = JsonTransformer.fromJSON(message, MediaMessage)
      const mediaRecord = await agent.modules.media.create({ connectionId: mediaMsg.connectionId })
      const record = await agent.modules.media.share({
        recordId: mediaRecord.id,
        description: mediaMsg.description,
        items: mediaMsg.items.map(item => ({
          id: item.id,
          uri: item.uri,
          description: item.description,
          mimeType: item.mimeType,
          byteCount: item.byteCount,
          ciphering: item.ciphering?.algorithm
            ? { ...item.ciphering, parameters: item.ciphering.parameters ?? {} }
            : undefined,
          fileName: item.filename,
          metadata: {
            preview: item.preview,
            width: item.width,
            height: item.height,
            duration: item.duration,
            title: item.title,
            icon: item.icon,
            openingMode: item.openingMode,
            screenOrientation: item.screenOrientation,
          },
        })),
      })
      messageId = record.threadId
    } else if (messageType === ReceiptsMessage.type) {
      const textMsg = JsonTransformer.fromJSON(message, ReceiptsMessage)
      await agent.modules.receipts.send({
        connectionId: textMsg.connectionId,
        receipts: textMsg.receipts.map(didcommReceiptFromVsAgentReceipt),
      })
    } else if (messageType === ReactionMessage.type) {
      const msg = JsonTransformer.fromJSON(message, ReactionMessage)
      await agent.modules.reactions.send({
        connectionId: msg.connectionId,
        reactions: msg.reactions.map(r => ({
          messageId: r.messageId,
          emoji: r.emoji,
          action: r.action,
          timestamp: r.timestamp,
        })),
      })
    } else if (messageType === MenuDisplayMessage.type) {
      const msg = JsonTransformer.fromJSON(message, MenuDisplayMessage)

      const record = await agent.modules.questionAnswer.sendQuestion(msg.connectionId, {
        question: msg.prompt,
        validResponses: msg.menuItems.map(item => new ValidResponse({ text: item.text })),
      })
      messageId = record.threadId

      record.metadata.add(
        'text-id-mapping',
        msg.menuItems.reduce((acc, curr) => ((acc[curr.text] = curr.id), acc), {} as Record<string, string>),
      )
      await agent.dependencyManager.resolve(QuestionAnswerRepository).update(agent.context, record)
    } else if (messageType === ContextualMenuUpdateMessage.type) {
      const msg = JsonTransformer.fromJSON(message, ContextualMenuUpdateMessage)

      await agent.modules.actionMenu.clearActiveMenu({
        connectionId: msg.connectionId,
        role: ActionMenuRole.Responder,
      })
      await agent.modules.actionMenu.sendMenu({
        connectionId: msg.connectionId,
        menu: {
          title: msg.title,
          description: msg.description ?? '',
          options: msg.options.map(
            item =>
              new ActionMenuOption({
                title: item.title,
                name: item.id,
                description: item.description ?? '',
              }),
          ),
        },
      })
    } else if (messageType === ProfileMessage.type) {
      const msg = JsonTransformer.fromJSON(message, ProfileMessage)
      const { displayImageUrl, displayName, displayIconUrl, description, preferredLanguage } = msg

      await agent.modules.userProfile.sendUserProfile({
        connectionId: connection.id,
        profileData: {
          displayName: displayName ?? undefined,
          displayPicture: displayImageUrl ? parsePictureData(displayImageUrl) : undefined,
          displayIcon: displayIconUrl ? parsePictureData(displayIconUrl) : undefined,
          description: description ?? undefined,
          preferredLanguage: preferredLanguage ?? undefined,
        },
      })
    } else if (messageType === CallOfferRequestMessage.type) {
      const msg = JsonTransformer.fromJSON(message, CallOfferRequestMessage)
      const callOffer = await agent.modules.calls.offer({
        connectionId: connection.id,
        offerExpirationTime: msg.offerExpirationTime,
        offerStartTime: msg.offerStartTime,
        description: msg.description,
        callType: 'service',
        parameters: msg.parameters,
      })
      messageId = callOffer.messageId
    } else if (messageType === CallEndRequestMessage.type) {
      const msg = JsonTransformer.fromJSON(message, CallEndRequestMessage)
      const hangup = await agent.modules.calls.hangup({
        connectionId: connection.id,
        threadId: msg.threadId,
      })
      messageId = hangup.messageId
    }

    return messageId
  }
}
