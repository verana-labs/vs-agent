import type { BaseAgentModules, VsAgent } from '../agent/VsAgent'

import { DidCommPresentationV1Message, DidCommPresentationV1ProblemReportMessage } from '@credo-ts/anoncreds'
import { BaseLogger } from '@credo-ts/core'
import {
  DidCommCredentialEventTypes,
  DidCommCredentialState,
  DidCommCredentialStateChangedEvent,
  DidCommEventTypes,
  DidCommMessageProcessedEvent,
  DidCommPresentationV2Message,
  DidCommPresentationV2ProblemReportMessage,
  DidCommProofState,
} from '@credo-ts/didcomm'
import {
  Claim,
  CredentialReceptionMessage,
  CredentialRequestMessage,
  IdentityProofSubmitMessage,
  PresentationState,
  PresentationStateUpdated,
  VerifiableCredentialSubmittedProofItem,
} from '@verana-labs/vs-agent-model'

import { ParticipantRole } from '../blockchain/types'
import { getRecordId } from '../utils/agent'

import { emitVsAgentEvent, msgToEvent, VsAgentEventTypes } from './VsAgentEvents'

export const baseMessageEvents = async (agent: VsAgent<BaseAgentModules>, logger: BaseLogger) => {
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
        logger.info('Presentation problem report received')
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
            const errorMap: Record<string, PresentationState> = {
              'Request declined': PresentationState.REFUSED,
              'e.req.no-compatible-credentials': PresentationState.NO_COMPATIBLE_CREDENTIALS,
              'e.p.untrusted-issuer': PresentationState.UNTRUSTED_ISSUER,
              'e.p.trust-registry-unavailable': PresentationState.VERIFICATION_ERROR,
            }
            emitVsAgentEvent(
              agent,
              VsAgentEventTypes.PresentationStateUpdated,
              new PresentationStateUpdated({
                proofExchangeId: record.id,
                callbackUrl: callbackParameters.callbackUrl,
                state: errorMap[errorCode] ?? PresentationState.UNSPECIFIED_ERROR,
                ref: callbackParameters.ref,
              }),
            )
          }

          emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(msg))
        } catch (error) {
          logger.error(`Error processing presentation problem report: ${error}`)
        }
      }

      if (
        [
          DidCommPresentationV1Message.type.messageTypeUri,
          DidCommPresentationV2Message.type.messageTypeUri,
        ].includes(message.type)
      ) {
        logger.info('Presentation received')

        try {
          const record = await agent.didcomm.proofs.getByThreadAndConnectionId(
            message.threadId,
            connection.id,
          )
          const formatData = await agent.didcomm.proofs.getFormatData(record.id)

          const callbackParameters = record.metadata.get('_2060/callbackParameters') as
            | { ref?: string; callbackUrl?: string }
            | undefined

          const emitPresentationState = (state: PresentationState, claims?: Claim[]) => {
            if (!callbackParameters?.callbackUrl) return
            emitVsAgentEvent(
              agent,
              VsAgentEventTypes.PresentationStateUpdated,
              new PresentationStateUpdated({
                proofExchangeId: record.id,
                callbackUrl: callbackParameters.callbackUrl,
                claims,
                state,
                verified: state === PresentationState.OK,
                ref: callbackParameters.ref,
              }),
            )
          }

          const trustRegistry = record.metadata.get('_2060/trustRegistry') as
            | { schemaId?: number }
            | undefined

          if (trustRegistry?.schemaId !== undefined) {
            const { untrusted, unchecked } = await findPresentationUntrustedIssuers(
              agent,
              formatData,
              trustRegistry.schemaId,
            ).catch(error => {
              logger.error(`Trust registry check failed: ${error}`)
              return { untrusted: [], unchecked: ['the presented credentials'] }
            })

            if (untrusted.length || unchecked.length) {
              const rejected = untrusted.length > 0
              logger.warn(
                rejected
                  ? `Presentation issued by unaccredited issuers: ${untrusted.join(', ')}`
                  : `Could not verify issuer accreditation of: ${unchecked.join(', ')}`,
              )

              const description = rejected ? 'e.p.untrusted-issuer' : 'e.p.trust-registry-unavailable'

              try {
                record.errorMessage = description
                record.state = DidCommProofState.Abandoned
                await agent.didcomm.proofs.update(record)
              } catch (error) {
                logger.error(`Could not persist the presentation rejection: ${error}`)
              }

              emitPresentationState(
                rejected ? PresentationState.UNTRUSTED_ISSUER : PresentationState.VERIFICATION_ERROR,
              )

              try {
                await agent.didcomm.proofs.sendProblemReport({
                  proofExchangeRecordId: record.id,
                  description,
                })
              } catch (error) {
                logger.error(`Could not send the presentation problem report: ${error}`)
              }

              return
            }

            if (record.state === DidCommProofState.PresentationReceived) {
              await agent.didcomm.proofs.acceptPresentation({ proofExchangeRecordId: record.id })
            }
          }

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

          emitPresentationState(
            record.isVerified ? PresentationState.OK : PresentationState.VERIFICATION_ERROR,
            claims,
          )

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

          emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(msg))
        } catch (error) {
          logger.error(`Error processing presentation message: ${error}`)
        }
      }
    },
  )

  // Credential events
  agent.events.on(
    DidCommCredentialEventTypes.DidCommCredentialStateChanged,
    async ({ payload }: DidCommCredentialStateChangedEvent) => {
      logger.debug(
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
        emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(message))
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
        emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(message))
      }
    },
  )
}

type PresentationFormatData = Awaited<
  ReturnType<VsAgent<BaseAgentModules>['didcomm']['proofs']['getFormatData']>
>

async function findPresentationUntrustedIssuers(
  agent: VsAgent<BaseAgentModules>,
  formatData: PresentationFormatData,
  schemaId: number,
): Promise<{ untrusted: string[]; unchecked: string[] }> {
  const identifiers =
    formatData.presentation?.anoncreds?.identifiers ?? formatData.presentation?.indy?.identifiers ?? []

  const credentialDefinitionIds = [...new Set(identifiers.map(identifier => identifier.cred_def_id))]

  const untrusted: string[] = []
  const unchecked: string[] = []
  const issuerDids: string[] = []

  for (const credentialDefinitionId of credentialDefinitionIds) {
    try {
      const { credentialDefinition } =
        await agent.modules.anoncreds.getCredentialDefinition(credentialDefinitionId)
      if (credentialDefinition) issuerDids.push(credentialDefinition.issuerId)
      else untrusted.push(credentialDefinitionId)
    } catch {
      unchecked.push(credentialDefinitionId)
    }
  }

  const accreditation = await agent.indexer.findUnaccreditedDids(issuerDids, ParticipantRole.Issuer, schemaId)

  return {
    untrusted: [...untrusted, ...accreditation.unaccredited],
    unchecked: [...unchecked, ...accreditation.unchecked],
  }
}
