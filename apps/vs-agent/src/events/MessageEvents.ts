import type { EventConfig } from '../utils/EventConfig'
import type { MessageReceiptsReceivedEvent, MessageState } from '@2060.io/credo-ts-didcomm-receipts'
import type { DidCommAgentModules } from '@verana-labs/vs-agent-sdk'

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
import { ReceiptsEventTypes } from '@2060.io/credo-ts-didcomm-receipts'
import {
  ConnectionProfileUpdatedEvent,
  ProfileEventTypes,
  UserProfileRequestedEvent,
} from '@2060.io/credo-ts-didcomm-user-profile'
import { MenuRequestMessage, PerformMessage } from '@credo-ts/action-menu'
import { DidCommPresentationV1Message, DidCommPresentationV1ProblemReportMessage } from '@credo-ts/anoncreds'
import {
  DidCommBasicMessage,
  DidCommCredentialEventTypes,
  DidCommCredentialState,
  DidCommCredentialStateChangedEvent,
  DidCommEventTypes,
  DidCommMessageProcessedEvent,
  DidCommPresentationV2Message,
  DidCommPresentationV2ProblemReportMessage,
} from '@credo-ts/didcomm'
import { AnswerMessage, QuestionAnswerService } from '@credo-ts/question-answer'
import {
  BaseMessage,
  Claim,
  MenuSelectMessage,
  IdentityProofSubmitMessage,
  TextMessage,
  CredentialRequestMessage,
  CredentialReceptionMessage,
  ContextualMenuRequestMessage,
  ContextualMenuSelectMessage,
  MediaMessage,
  CallOfferRequestMessage,
  CallEndRequestMessage,
  CallRejectRequestMessage,
  ProfileMessage,
  VerifiableCredentialSubmittedProofItem,
  MessageStateUpdated,
  MessageReceived,
  CallAcceptRequestMessage,
} from '@verana-labs/vs-agent-model'

import { createDataUrl, VsAgent } from '../utils'

import { PresentationStatus, sendPresentationCallbackEvent } from './CallbackEvent'
import { sendWebhookEvent } from './WebhookEvent'

// FIXME: timestamps are currently taken from reception date. They should be get from the originating DIDComm message
// as soon as the corresponding extension is added to them
export const messageEvents = async (agent: VsAgent<DidCommAgentModules>, config: EventConfig) => {
  agent.events.on(
    DidCommEventTypes.DidCommMessageProcessed,
    async ({ payload }: DidCommMessageProcessedEvent) => {
      config.logger.debug(`DidCommMessageProcessedEvent received: ${JSON.stringify(payload.message)}`)
      const { message, connection } = payload

      if (!connection) {
        config.logger.warn(
          `[messageEvents] Received contactless message of type ${message.type}. Not supported yet.`,
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
          timestamp: new Date(), // It can take also 'sentTime' to be related to the origin
        })

        if (msg.threadId) msg.threadId = await getRecordId(agent, msg.threadId)
        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
      }

      // Action Menu protocol messages
      if (message.type === MenuRequestMessage.type.messageTypeUri) {
        const msg = new ContextualMenuRequestMessage({
          connectionId: connection.id,
          id: connection.id,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
      }

      if (message.type === PerformMessage.type.messageTypeUri) {
        const msg = new ContextualMenuSelectMessage({
          selectionId: (message as PerformMessage).name,
          connectionId: connection.id,
          id: message.id,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
      }

      // Question Answer protocol messages
      if (message.type === AnswerMessage.type.messageTypeUri) {
        const record = await agent.dependencyManager
          .resolve(QuestionAnswerService)
          .getByThreadAndConnectionId(agent.context, connection.id, message.threadId)

        const textIdMapping = record.metadata.get<Record<string, string>>('text-id-mapping')

        if (!textIdMapping) {
          config.logger.warn(
            `[messageEvents] No text-id mapping found for Menu message. Using responded text as identifier`,
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

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
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

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
      }

      if (message.type === CallEndMessage.type.messageTypeUri) {
        const thread = (message as CallEndMessage).thread
        const msg = new CallEndRequestMessage({
          id: await getRecordId(agent, message.id),
          connectionId: connection.id,
          threadId: thread?.threadId,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
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

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
      }

      if (message.type === CallRejectMessage.type.messageTypeUri) {
        const thread = (message as CallEndMessage).thread
        const msg = new CallRejectRequestMessage({
          id: await getRecordId(agent, message.id),
          connectionId: connection.id,
          threadId: thread?.threadId,
          timestamp: new Date(),
        })

        await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
      }

      if (
        [
          DidCommPresentationV2ProblemReportMessage.type.messageTypeUri,
          DidCommPresentationV1ProblemReportMessage.type.messageTypeUri,
        ].includes(message.type)
      ) {
        config.logger.info('Presentation problem report received')
        try {
          const record = await agent.didcomm.proofs.getByThreadAndConnectionId(
            message.threadId,
            connection.id,
          )
          const errorCode =
            (message as DidCommPresentationV2ProblemReportMessage).description.en ??
            (message as DidCommPresentationV2ProblemReportMessage).description.code

          const msg = new IdentityProofSubmitMessage({
            submittedProofItems: [
              new VerifiableCredentialSubmittedProofItem({
                errorCode,
                id: record.threadId, // TODO: store id as a tag
                proofExchangeId: record.id,
              }),
            ],
            connectionId: record.connectionId!,
            id: message.id,
            threadId: await getRecordId(agent, record.threadId),
            timestamp: record.updatedAt,
          })

          // Call callbackUrl if existant. Depending on the received error code, set status
          const callbackParameters = record.metadata.get('_2060/callbackParameters') as
            | { ref?: string; callbackUrl?: string }
            | undefined

          if (callbackParameters && callbackParameters.callbackUrl) {
            const errorMap: Record<string, PresentationStatus> = {
              'Request declined': PresentationStatus.REFUSED,
              'e.req.no-compatible-credentials': PresentationStatus.NO_COMPATIBLE_CREDENTIALS,
            }
            await sendPresentationCallbackEvent({
              proofExchangeId: record.id,
              callbackUrl: callbackParameters.callbackUrl,
              status: errorMap[errorCode] ?? PresentationStatus.UNSPECIFIED_ERROR,
              logger: config.logger,
              ref: callbackParameters.ref,
            })
          }

          await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
        } catch (error) {
          config.logger.error(`Error processing presentation problem report: ${error}`)
        }
      }
      // Proofs protocol messages
      if (
        [
          DidCommPresentationV1Message.type.messageTypeUri,
          DidCommPresentationV2Message.type.messageTypeUri,
        ].includes(message.type)
      ) {
        config.logger.info('Presentation received')

        try {
          const record = await agent.didcomm.proofs.getByThreadAndConnectionId(
            message.threadId,
            connection.id,
          )

          const formatData = await agent.didcomm.proofs.getFormatData(record.id)

          const revealedAttributes =
            formatData.presentation?.anoncreds?.requested_proof.revealed_attrs ??
            formatData.presentation?.indy?.requested_proof.revealed_attrs

          const revealedAttributeGroups =
            formatData.presentation?.anoncreds?.requested_proof?.revealed_attr_groups ??
            formatData.presentation?.indy?.requested_proof.revealed_attr_groups

          const claims: Claim[] = []
          if (revealedAttributes) {
            for (const [name, value] of Object.entries(revealedAttributes)) {
              claims.push(new Claim({ name, value: value.raw }))
            }
          }

          if (revealedAttributeGroups) {
            for (const [, groupAttributes] of Object.entries(revealedAttributeGroups)) {
              for (const attrName in groupAttributes.values) {
                claims.push(new Claim({ name: attrName, value: groupAttributes.values[attrName].raw }))
              }
            }
          }

          // Call callbackUrl if existant. Depending on the received error code, set status
          const callbackParameters = record.metadata.get('_2060/callbackParameters') as
            | { ref?: string; callbackUrl?: string }
            | undefined

          if (callbackParameters && callbackParameters.callbackUrl) {
            await sendPresentationCallbackEvent({
              proofExchangeId: record.id,
              callbackUrl: callbackParameters.callbackUrl,
              claims,
              status: record.isVerified ? PresentationStatus.OK : PresentationStatus.VERIFICATION_ERROR,
              logger: config.logger,
              ref: callbackParameters.ref,
            })
          }

          const msg = new IdentityProofSubmitMessage({
            submittedProofItems: [
              new VerifiableCredentialSubmittedProofItem({
                id: record.threadId, // TODO: store id as a tag
                proofExchangeId: record.id,
                claims,
                verified: record.isVerified ?? false,
              }),
            ],
            connectionId: record.connectionId!,
            id: message.id,
            threadId: await getRecordId(agent, record.threadId),
            timestamp: record.updatedAt,
          })

          await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
        } catch (error) {
          config.logger.error(`Error processing presentation message: ${error}`)
        }
      }
    },
  )

  // Credential events
  agent.events.on(
    DidCommCredentialEventTypes.DidCommCredentialStateChanged,
    async ({ payload }: DidCommCredentialStateChangedEvent) => {
      config.logger.debug(`DidCommCredentialStateChangedEvent received. Record id: 
      ${JSON.stringify(payload.credentialExchangeRecord.id)}, state: ${JSON.stringify(payload.credentialExchangeRecord.state)}`)
      const record = payload.credentialExchangeRecord

      if (record.state === DidCommCredentialState.ProposalReceived) {
        const credentialProposalMessage = await agent.didcomm.credentials.findProposalMessage(record.id)
        const message = new CredentialRequestMessage({
          connectionId: record.connectionId!,
          id: record.id,
          threadId: credentialProposalMessage?.threadId,
          claims:
            credentialProposalMessage?.credentialPreview?.attributes.map(
              p => new Claim({ name: p.name, value: p.value, mimeType: p.mimeType }),
            ) ?? [],
          credentialDefinitionId: record.metadata.get('_internal/anonCredsCredentialDefinitionMetadata')
            ?.credentialDefinitionId,
          timestamp: record.createdAt,
        })

        if (message.threadId) message.threadId = await getRecordId(agent, message.threadId)
        await sendMessageReceivedEvent(agent, message, message.timestamp, config)
      } else if (
        [
          DidCommCredentialState.Declined,
          DidCommCredentialState.Done,
          DidCommCredentialState.Abandoned,
        ].includes(record.state)
      ) {
        const message = new CredentialReceptionMessage({
          connectionId: record.connectionId!,
          id: record.id,
          threadId: await getRecordId(agent, record.threadId),
          state:
            record.errorMessage === 'issuance-abandoned: e.msg.refused'
              ? DidCommCredentialState.Declined
              : record.state,
        })
        await sendMessageReceivedEvent(agent, message, message.timestamp, config)
      }
    },
  )

  // Media protocol events
  agent.events.on(
    DidCommMediaSharingEventTypes.StateChanged,
    async ({ payload }: DidCommMediaSharingStateChangedEvent) => {
      const record = payload.mediaSharingRecord

      config.logger
        .debug(`MediaSharingStateChangedEvent received. Role: ${record.role} Connection id: ${record.connectionId}. 
    Items: ${JSON.stringify(record.items)} `)

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
          await sendMessageReceivedEvent(agent, message, message.timestamp, config)
        }
      }
    },
  )

  // Receipts protocol events
  agent.events.on(
    ReceiptsEventTypes.MessageReceiptsReceived,
    async ({ payload }: MessageReceiptsReceivedEvent) => {
      const connectionId = payload.connectionId
      config.logger.debug(`MessageReceiptsReceivedEvent received. Connection id: ${connectionId}. 
    Receipts: ${JSON.stringify(payload.receipts)} `)
      const receipts = payload.receipts

      receipts.forEach(receipt => {
        const { messageId, timestamp, state } = receipt
        sendMessageStateUpdatedEvent({ agent, messageId, connectionId, state, timestamp, config })
      })
    },
  )

  // User profile events
  agent.events.on(ProfileEventTypes.UserProfileRequested, async ({ payload }: UserProfileRequestedEvent) => {
    config.logger.debug(`UserProfileRequestedEvent received. Connection id: ${payload.connection.id} 
      Query: ${JSON.stringify(payload.query)}`)

    // Currently we only send the profile if we are using our "main" connection
    const outOfBandRecordId = payload.connection.outOfBandId
    if (outOfBandRecordId) {
      const outOfBandRecord = await agent.didcomm.oob.findById(outOfBandRecordId)
      const parentConnectionId = outOfBandRecord?.getTag('parentConnectionId') as string | undefined
      if (!parentConnectionId && agent.autoDiscloseUserProfile)
        await agent.modules.userProfile.sendUserProfile({ connectionId: payload.connection.id })
    }
  })

  agent.events.on(
    ProfileEventTypes.ConnectionProfileUpdated,
    async ({ payload: { connection, profile } }: ConnectionProfileUpdatedEvent) => {
      const { displayName, displayPicture, displayIcon, description, preferredLanguage } = profile
      config.logger.debug(`ConnectionProfileUpdatedEvent received. Connection id: ${connection.id} 
        Profile: ${JSON.stringify(profile)}`)

      const msg = new ProfileMessage({
        connectionId: connection.id,
        displayName,
        displayImageUrl: displayPicture && createDataUrl(displayPicture),
        displayIconUrl: displayIcon && createDataUrl(displayIcon),
        description,
        preferredLanguage,
      })

      await sendMessageReceivedEvent(agent, msg, msg.timestamp, config)
    },
  )

  // At the moment we only support refusal/timeouts. Other errors are TBD
}

export { messageEvents as chatEvents }

const sendMessageReceivedEvent = async (
  agent: VsAgent<DidCommAgentModules>,
  message: BaseMessage,
  timestamp: Date,
  config: EventConfig,
) => {
  const body = new MessageReceived({
    timestamp,
    message: message,
  })

  await sendWebhookEvent(config.webhookUrl + '/message-received', body, config.logger)
}

const sendMessageStateUpdatedEvent = async (options: {
  agent: VsAgent<DidCommAgentModules>
  messageId: string
  connectionId: string
  state: MessageState
  timestamp: Date
  config: EventConfig
}) => {
  const { agent, messageId, connectionId, state, timestamp, config } = options
  const recordId = await agent.genericRecords.findById(messageId)

  const body = new MessageStateUpdated({
    messageId: (recordId?.getTag('messageId') as string) ?? messageId,
    state,
    timestamp,
    connectionId,
  })
  await sendWebhookEvent(config.webhookUrl + '/message-state-updated', body, config.logger)
}

const getRecordId = async (agent: VsAgent<DidCommAgentModules>, id: string): Promise<string> => {
  const record = await agent.genericRecords.findById(id)
  return (record?.getTag('messageId') as string) ?? id
}
