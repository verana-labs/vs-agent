import type { BaseAgentModules, VsAgentPluginConfig } from '@verana-labs/vs-agent-sdk'

import { DidCommPresentationV1Message, DidCommPresentationV1ProblemReportMessage } from '@credo-ts/anoncreds'
import {
  DidCommCredentialEventTypes,
  DidCommCredentialState,
  DidCommCredentialStateChangedEvent,
  DidCommEventTypes,
  DidCommMessageProcessedEvent,
  DidCommPresentationV2Message,
  DidCommPresentationV2ProblemReportMessage,
} from '@credo-ts/didcomm'
import {
  Claim,
  CredentialReceptionMessage,
  CredentialRequestMessage,
  IdentityProofSubmitMessage,
  VerifiableCredentialSubmittedProofItem,
} from '@verana-labs/vs-agent-model'
import { getRecordId, sendMessageReceivedEvent, VsAgent } from '@verana-labs/vs-agent-sdk'

import { PresentationStatus, sendPresentationCallbackEvent } from './CallbackEvent'

export const baseMessageEvents = async (agent: VsAgent<BaseAgentModules>, config: VsAgentPluginConfig) => {
  // Proofs protocol messages (proof presentation and problem reports)
  agent.events.on(
    DidCommEventTypes.DidCommMessageProcessed,
    async ({ payload }: DidCommMessageProcessedEvent) => {
      const { message, connection } = payload

      if (!connection) return

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
                id: record.threadId,
                proofExchangeId: record.id,
              }),
            ],
            connectionId: record.connectionId!,
            id: message.id,
            threadId: await getRecordId(agent, record.threadId),
            timestamp: record.updatedAt,
          })

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

          await sendMessageReceivedEvent(msg, msg.timestamp, config)
        } catch (error) {
          config.logger.error(`Error processing presentation problem report: ${error}`)
        }
      }

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
                id: record.threadId,
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

          await sendMessageReceivedEvent(msg, msg.timestamp, config)
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
      config.logger.debug(
        `DidCommCredentialStateChangedEvent received. Record id: ${JSON.stringify(payload.credentialExchangeRecord.id)}, state: ${JSON.stringify(payload.credentialExchangeRecord.state)}`,
      )
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
        await sendMessageReceivedEvent(message, message.timestamp, config)
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
        await sendMessageReceivedEvent(message, message.timestamp, config)
      }
    },
  )
}
