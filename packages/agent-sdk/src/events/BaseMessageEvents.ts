import type { BaseAgentModules, VsAgent } from '../agent/VsAgent'
import type { AnonCredsProof } from '@credo-ts/anoncreds'
import type { DidCommConnectionRecord, DidCommProofExchangeRecord } from '@credo-ts/didcomm'

import { DidCommPresentationV1Message, DidCommPresentationV1ProblemReportMessage } from '@credo-ts/anoncreds'
import { BaseLogger, CredoError } from '@credo-ts/core'
import {
  DidCommCredentialEventTypes,
  DidCommCredentialState,
  DidCommCredentialStateChangedEvent,
  DidCommEventTypes,
  DidCommMessageProcessedEvent,
  DidCommMessageSender,
  DidCommPresentationV2Message,
  DidCommPresentationV2ProblemReportMessage,
  DidCommProofRole,
  DidCommProofsModuleConfig,
  DidCommProofState,
  getOutboundDidCommMessageContext,
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

import {
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  AnonCredsTrustProblemCode,
  AUTO_ACCEPT_PRESENTATION_METADATA,
  REQUESTED_CREDENTIAL_SCHEMAS_METADATA,
  type RequestedCredentialSchemas,
} from '../blockchain/AnonCredsTrustService'
import { ParticipantRole } from '../blockchain/types'
import { getRecordId } from '../utils/agent'

import { emitVsAgentEvent, msgToEvent, VsAgentEventTypes } from './VsAgentEvents'

export const baseMessageEvents = async (agent: VsAgent<BaseAgentModules>, logger: BaseLogger) => {
  registerAnonCredsTrustDecision(agent, logger)

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
            emitVsAgentEvent(
              agent,
              VsAgentEventTypes.PresentationStateUpdated,
              new PresentationStateUpdated({
                proofExchangeId: record.id,
                callbackUrl: callbackParameters.callbackUrl,
                claims,
                state: record.isVerified ? PresentationState.OK : PresentationState.VERIFICATION_ERROR,
                verified: record.isVerified ?? false,
                ref: callbackParameters.ref,
              }),
            )
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

function registerAnonCredsTrustDecision(agent: VsAgent<BaseAgentModules>, logger: BaseLogger): void {
  agent.didcomm.registerMessageHandlerMiddleware(async (messageContext, next) => {
    await next()

    const { connection, message } = messageContext
    const isPresentation = [
      DidCommPresentationV1Message.type.messageTypeUri,
      DidCommPresentationV2Message.type.messageTypeUri,
    ].includes(message.type)

    if (!isPresentation || !connection) return

    let record: DidCommProofExchangeRecord | undefined
    let presentation: AnonCredsProof | undefined
    try {
      record = await agent.didcomm.proofs.getByThreadAndConnectionId(message.threadId, connection.id)
      const formatData = await agent.didcomm.proofs.getFormatData(record.id)
      presentation = formatData.presentation?.anoncreds ?? formatData.presentation?.indy
    } catch (error) {
      logger.error(`The agent cannot read the presentation of ${message.threadId}: ${error}`)
      messageContext.responseMessage = undefined

      // The check did not run, so the exchange ends here, per [VSA-VTI-FLOW-VERIFY-AC-8]
      if (record?.role === DidCommProofRole.Verifier) {
        await abandonPresentation(
          agent,
          record,
          connection,
          AnonCredsTrustProblemCode.TrustResolutionUnavailable,
          `the agent cannot read the presentation: ${error}`,
          logger,
        )
      }
      return
    }

    if (await applyAnonCredsTrustDecision(agent, record, connection, presentation, logger)) {
      messageContext.responseMessage = undefined
      return
    }

    // The proof and the trust decision both succeeded, so the agent acknowledges the presentation.
    const policy = record.metadata.get<{ autoAccept: boolean }>(AUTO_ACCEPT_PRESENTATION_METADATA)
    if (!policy?.autoAccept || record.state !== DidCommProofState.PresentationReceived) return

    try {
      await agent.didcomm.proofs.acceptPresentation({ proofExchangeRecordId: record.id })
    } catch (error) {
      logger.error(`The agent cannot acknowledge the presentation ${record.id}: ${error}`)
    }
  })
}

async function applyAnonCredsTrustDecision(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
  connection: DidCommConnectionRecord,
  presentation: AnonCredsProof | undefined,
  logger: BaseLogger,
): Promise<boolean> {
  if (record.role !== DidCommProofRole.Verifier || !presentation) return false

  const identifiers = presentation.identifiers ?? []

  const requestedCredentialSchemas = Object.entries(
    record.metadata.get<RequestedCredentialSchemas>(REQUESTED_CREDENTIAL_SCHEMAS_METADATA) ?? {},
  )

  // A request whose creator recorded no CredentialSchema cannot be checked against what it asked
  // for, so it abandons rather than accepting any schema.
  if (requestedCredentialSchemas.length === 0) {
    await abandonPresentation(
      agent,
      record,
      connection,
      AnonCredsTrustProblemCode.TrustResolutionUnavailable,
      'the exchange records no CredentialSchema of its requested credentials',
      logger,
    )
    return true
  }

  // Each requested group has one sub proof. The sub proof names its credential definition.
  const answered: Record<string, { sub_proof_index: number } | undefined> = {
    ...presentation.requested_proof?.revealed_attrs,
    ...presentation.requested_proof?.revealed_attr_groups,
    ...presentation.requested_proof?.unrevealed_attrs,
    ...presentation.requested_proof?.predicates,
  }

  const issuersByCredentialSchema = new Map<number, string[]>()
  const unaccredited: string[] = []
  const unchecked: string[] = []

  for (const [group, requested] of requestedCredentialSchemas) {
    const subProofIndex = answered[group]?.sub_proof_index
    const credentialDefinitionId =
      subProofIndex === undefined ? undefined : identifiers[subProofIndex]?.cred_def_id

    if (!credentialDefinitionId) {
      unchecked.push(`the presentation identifies no credential for the requested group "${group}"`)
      continue
    }

    try {
      const derived = await agent.anonCredsTrust.deriveCredentialSchema({ credentialDefinitionId })

      if (derived.credentialSchemaId !== requested.credentialSchemaId) {
        unaccredited.push(
          `${credentialDefinitionId} presents the CredentialSchema ${derived.credentialSchemaId} for the group "${group}", which asks for the CredentialSchema ${requested.credentialSchemaId}`,
        )
        continue
      }

      if (!derived.issuerId) {
        unaccredited.push(`${credentialDefinitionId} names no issuer`)
        continue
      }

      const issuers = issuersByCredentialSchema.get(derived.credentialSchemaId) ?? []
      issuers.push(derived.issuerId)
      issuersByCredentialSchema.set(derived.credentialSchemaId, issuers)
    } catch (error) {
      const cannotCheck =
        !(error instanceof AnonCredsTrustError) || error.reason === AnonCredsTrustErrorReason.Unavailable
      if (cannotCheck) unchecked.push(`${error}`)
      else unaccredited.push(`${error}`)
    }
  }

  for (const [credentialSchemaId, issuers] of issuersByCredentialSchema) {
    const result = await agent.anonCredsTrust.findUnaccreditedDids(
      issuers,
      ParticipantRole.Issuer,
      credentialSchemaId,
    )
    unaccredited.push(
      ...result.unaccredited.map(
        did => `${did} holds no active ISSUER Participant for the CredentialSchema ${credentialSchemaId}`,
      ),
    )
    unchecked.push(
      ...result.unchecked.map(
        did =>
          `the agent cannot check the ISSUER Participant of ${did} for the CredentialSchema ${credentialSchemaId}`,
      ),
    )
  }

  if (unaccredited.length === 0 && unchecked.length === 0) return false

  const code =
    unaccredited.length > 0
      ? AnonCredsTrustProblemCode.IssuerNotAuthorized
      : AnonCredsTrustProblemCode.TrustResolutionUnavailable

  await abandonPresentation(
    agent,
    record,
    connection,
    code,
    [...unaccredited, ...unchecked].join('; '),
    logger,
  )

  return true
}

async function abandonPresentation(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
  connection: DidCommConnectionRecord,
  code: AnonCredsTrustProblemCode,
  description: string,
  logger: BaseLogger,
): Promise<void> {
  logger.warn(`The presentation ${record.id} fails the AnonCreds trust decision (${code}): ${description}`)

  record.isVerified = false
  record.errorMessage = `${code}: ${description}`

  // `updateState` emits the state change with `previousState`, per [VSA-VTI-FLOW-VERIFY-AC-7]
  const protocol = agent.dependencyManager
    .resolve(DidCommProofsModuleConfig)
    .proofProtocols.find(candidate => candidate.version === record.protocolVersion)

  if (!protocol) {
    throw new CredoError(
      `No proof protocol registered for protocol version ${record.protocolVersion}, so the presentation ${record.id} cannot end in abandoned`,
    )
  }

  const problemReport =
    record.protocolVersion === 'v1'
      ? new DidCommPresentationV1ProblemReportMessage({ description: { code, en: description } })
      : new DidCommPresentationV2ProblemReportMessage({ description: { code, en: description } })
  problemReport.setThread({ threadId: record.threadId, parentThreadId: record.parentThreadId })

  try {
    const outboundMessageContext = await getOutboundDidCommMessageContext(agent.context, {
      message: problemReport,
      associatedRecord: record,
      connectionRecord: connection,
    })
    await agent.dependencyManager.resolve(DidCommMessageSender).sendMessage(outboundMessageContext)
  } catch (error) {
    logger.error(`The agent cannot send the problem report of presentation ${record.id}: ${error}`)
  }

  await protocol.updateState(agent.context, record, DidCommProofState.Abandoned)
}
