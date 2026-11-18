import type { BaseAgentModules, VsAgent } from '../agent/VsAgent'
import type { AnonCredsProof } from '@credo-ts/anoncreds'
import type { DidCommConnectionRecord, DidCommProofExchangeRecord } from '@credo-ts/didcomm'

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
  PRESENTED_CREDENTIALS_METADATA,
  REJECTED_CREDENTIALS_METADATA,
  REQUESTED_CREDENTIAL_SCHEMAS_METADATA,
  type PresentedCredential,
  type RejectedCredential,
  type RequestedCredentialSchemas,
  type UnaccreditedDidsResult,
} from '../blockchain/AnonCredsTrustService'
import { ParticipantRole } from '../blockchain/types'
import { getRecordId } from '../utils/agent'

import {
  emitVsAgentEvent,
  msgToEvent,
  VsAgentEventTypes,
  type VsAgentPresentationTrustDecidedEvent,
} from './VsAgentEvents'

export const baseMessageEvents = async (agent: VsAgent<BaseAgentModules>, logger: BaseLogger) => {
  registerAnonCredsTrustDecision(agent, logger)

  // Proofs protocol messages (proof presentation and problem reports)
  agent.events.on(
    DidCommEventTypes.DidCommMessageProcessed,
    async ({ payload }: DidCommMessageProcessedEvent) => {
      const { message, connection } = payload

      if (!connection) return

      if (message.type === DidCommPresentationV2ProblemReportMessage.type.messageTypeUri) {
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

      if (message.type === DidCommPresentationV2Message.type.messageTypeUri) {
        logger.info('Presentation received')

        try {
          const record = await agent.didcomm.proofs.getByThreadAndConnectionId(
            message.threadId,
            connection.id,
          )
          const formatData = await agent.didcomm.proofs.getFormatData(record.id)

          const revealedAttributes = formatData.presentation?.anoncreds?.requested_proof.revealed_attrs

          const revealedAttributeGroups =
            formatData.presentation?.anoncreds?.requested_proof.revealed_attr_groups

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

/**
 * A trust decision in flight completes in less than this time. The function
 * `completePendingTrustDecisions` does not decide a record that is younger: the message handler of
 * this process, or of another process on the same wallet, can decide it at that moment.
 */
const PENDING_TRUST_DECISION_MIN_AGE_MS = 60_000

interface TrustDecisionState {
  /** These are the threads of the presentations that this process decides at this moment. */
  deciding: Set<string>
  /** This timer starts the next examination of the pending trust decisions. */
  nextExamination?: ReturnType<typeof setTimeout>
}

const trustDecisionStates = new WeakMap<object, TrustDecisionState>()

function trustDecisionStateOf(agent: VsAgent<BaseAgentModules>): TrustDecisionState {
  let state = trustDecisionStates.get(agent)
  if (!state) {
    state = { deciding: new Set() }
    trustDecisionStates.set(agent, state)
  }
  return state
}

/**
 * Credo sets `presentation-received` before the trust decision of [VSA-VTI-FLOW-VERIFY-AC-7] runs.
 * The decision records the presented credentials when it succeeds. Before that, the record is not
 * `verified`. The caller cannot acknowledge the presentation, and cannot decline it.
 */
export function awaitsTrustDecision(record: DidCommProofExchangeRecord): boolean {
  return (
    record.role === DidCommProofRole.Verifier &&
    record.state === DidCommProofState.PresentationReceived &&
    !record.metadata.get(PRESENTED_CREDENTIALS_METADATA)
  )
}

function registerAnonCredsTrustDecision(agent: VsAgent<BaseAgentModules>, logger: BaseLogger): void {
  const { deciding } = trustDecisionStateOf(agent)

  agent.didcomm.registerMessageHandlerMiddleware(async (messageContext, next) => {
    const { message } = messageContext
    if (message.type !== DidCommPresentationV2Message.type.messageTypeUri) return next()

    deciding.add(message.threadId)
    try {
      await next()

      // A presentation with no connection answers a request of an invitation. The trust decision
      // applies to it also.
      const { connection } = messageContext

      let record: DidCommProofExchangeRecord | null
      try {
        record = connection
          ? await agent.didcomm.proofs.getByThreadAndConnectionId(message.threadId, connection.id)
          : ((
              await agent.didcomm.proofs.findAllByQuery({
                threadId: message.threadId,
                role: DidCommProofRole.Verifier,
              })
            )[0] ?? null)
      } catch (error) {
        logger.error(`The agent cannot read the presentation of ${message.threadId}: ${error}`)
        messageContext.responseMessage = undefined

        // The agent has no record to abandon. It examines the pending trust decisions again later:
        // that examination completes the decision, or it ends the exchange in `abandoned`.
        completePendingTrustDecisionsLater(agent, logger, PENDING_TRUST_DECISION_MIN_AGE_MS)
        return
      }

      if (!record) return

      if (await completeTrustDecision(agent, record, connection, logger)) {
        messageContext.responseMessage = undefined
      }
    } finally {
      deciding.delete(message.threadId)
    }
  })
}

/**
 * This function runs the trust decision of [VSA-VTI-FLOW-VERIFY-AC-7] on a received presentation.
 * It acknowledges the presentation when the exchange asks for it. It returns `true` when the
 * decision failed. The exchange is then in `abandoned`.
 */
async function completeTrustDecision(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
  connection: DidCommConnectionRecord | undefined,
  logger: BaseLogger,
): Promise<boolean> {
  let presentation: AnonCredsProof | undefined
  try {
    const formatData = await agent.didcomm.proofs.getFormatData(record.id)
    presentation = formatData.presentation?.anoncreds
  } catch (error) {
    logger.error(`The agent cannot read the presentation ${record.id}: ${error}`)

    // The check did not run, so the exchange ends here, per [VSA-VTI-FLOW-VERIFY-AC-8]
    if (record.role === DidCommProofRole.Verifier) {
      await abandonPresentation(
        agent,
        record,
        connection,
        AnonCredsTrustProblemCode.TrustResolutionUnavailable,
        `the agent cannot read the presentation: ${error}`,
        logger,
      )
    }
    return true
  }

  if (await applyAnonCredsTrustDecision(agent, record, connection, presentation, logger)) return true

  // The proof and the trust decision both succeeded, so the agent acknowledges the presentation.
  const policy = record.metadata.get<{ autoAccept: boolean }>(AUTO_ACCEPT_PRESENTATION_METADATA)
  if (!policy?.autoAccept || record.state !== DidCommProofState.PresentationReceived) return false

  try {
    await agent.didcomm.proofs.acceptPresentation({ proofExchangeRecordId: record.id })
  } catch (error) {
    logger.error(`The agent cannot acknowledge the presentation ${record.id}: ${error}`)
  }

  return false
}

/**
 * This function completes the trust decision of each received presentation that has none.
 *
 * - A stop of the agent before the decision leaves such a record. An earlier version of the agent
 *   leaves such a record also. The caller cannot acknowledge that record, and cannot decline it.
 * - Call this function at each start, after the event listeners are registered. The decision emits
 *   the event of `presentation-received`.
 * - The decision uses the state of the ledger at the time of the call, not at the time of the
 *   presentation.
 * - A decision that cannot complete ends the exchange in `abandoned`, per
 *   [VSA-VTI-FLOW-VERIFY-AC-8].
 * - The function does not decide a record that is younger than `minAgeMs`. Another process can
 *   decide that record at this moment. The function examines that record again later.
 */
export async function completePendingTrustDecisions(
  agent: VsAgent<BaseAgentModules>,
  logger: BaseLogger,
  { minAgeMs = PENDING_TRUST_DECISION_MIN_AGE_MS }: { minAgeMs?: number } = {},
): Promise<void> {
  // A timer can start this function after the agent stopped
  if (!agent.isInitialized) return

  const { deciding } = trustDecisionStateOf(agent)

  let pending: DidCommProofExchangeRecord[]
  try {
    pending = await agent.didcomm.proofs.findAllByQuery({
      role: DidCommProofRole.Verifier,
      state: DidCommProofState.PresentationReceived,
    })
  } catch (error) {
    logger.error(`The agent cannot read the presentations that wait for the trust decision: ${error}`)
    return
  }

  let examineAgainInMs = 0

  // A record with a decision waits for the caller, so the agent does not read it again
  for (const { id, threadId } of pending.filter(awaitsTrustDecision)) {
    // The message handler of this process decides this presentation at this moment
    if (deciding.has(threadId)) continue

    deciding.add(threadId)
    try {
      // The record can change after the query, so the agent reads it again
      const record = await agent.didcomm.proofs.findById(id)
      if (!record || !awaitsTrustDecision(record)) continue

      const ageMs = Date.now() - (record.updatedAt ?? record.createdAt).getTime()
      if (ageMs < minAgeMs) {
        examineAgainInMs = Math.max(examineAgainInMs, minAgeMs - ageMs)
        continue
      }

      const connection = record.connectionId
        ? ((await agent.didcomm.connections.findById(record.connectionId)) ?? undefined)
        : undefined

      logger.info(`The agent completes the trust decision of the presentation ${id}`)
      await completeTrustDecision(agent, record, connection, logger)
    } catch (error) {
      logger.error(`The agent cannot complete the trust decision of the presentation ${id}: ${error}`)
    } finally {
      deciding.delete(threadId)
    }
  }

  if (examineAgainInMs > 0) completePendingTrustDecisionsLater(agent, logger, examineAgainInMs, minAgeMs)
}

/** This function starts one later examination of the pending trust decisions of an agent. */
function completePendingTrustDecisionsLater(
  agent: VsAgent<BaseAgentModules>,
  logger: BaseLogger,
  delayMs: number,
  minAgeMs?: number,
): void {
  const state = trustDecisionStateOf(agent)

  // One examination decides every pending record, so the agent keeps one timer only
  if (state.nextExamination) return

  state.nextExamination = setTimeout(() => {
    state.nextExamination = undefined
    void completePendingTrustDecisions(agent, logger, { minAgeMs })
  }, delayMs)

  // The timer does not keep the process alive
  state.nextExamination.unref()
}

async function applyAnonCredsTrustDecision(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
  connection: DidCommConnectionRecord | undefined,
  presentation: AnonCredsProof | undefined,
  logger: BaseLogger,
): Promise<boolean> {
  if (record.role !== DidCommProofRole.Verifier) return false

  // The agent can check an AnonCreds presentation only. A presentation with no decision can be
  // neither acknowledged nor declined, so the exchange ends here, per [VSA-VTI-FLOW-VERIFY-AC-8].
  if (!presentation) {
    await abandonPresentation(
      agent,
      record,
      connection,
      AnonCredsTrustProblemCode.TrustResolutionUnavailable,
      'the presentation has no AnonCreds proof',
      logger,
    )
    return true
  }

  const identifiers = presentation.identifiers ?? []

  const stored = record.metadata.get(REQUESTED_CREDENTIAL_SCHEMAS_METADATA) as
    | RequestedCredentialSchemas
    | number[]
    | null
  const requestedCredentialSchemas = Object.entries(Array.isArray(stored) ? {} : (stored ?? {}))

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

  const answered: Record<string, { sub_proof_index: number } | undefined> = {
    ...presentation.requested_proof?.revealed_attrs,
    ...presentation.requested_proof?.revealed_attr_groups,
    ...presentation.requested_proof?.unrevealed_attrs,
    ...presentation.requested_proof?.predicates,
  }

  const candidates: Array<PresentedCredential & { index: number }> = []
  const rejected: RejectedCredential[] = []
  const reject = (
    index: number,
    code: AnonCredsTrustProblemCode,
    note: string,
    known: Pick<RejectedCredential, 'credentialDefinitionId' | 'issuerDid' | 'credentialSchemaId'> = {},
  ) => rejected.push({ index, code, note, ...known })

  for (const [index, [group, requested]] of requestedCredentialSchemas.entries()) {
    const subProofIndex = answered[group]?.sub_proof_index
    const credentialDefinitionId =
      subProofIndex === undefined ? undefined : identifiers[subProofIndex]?.cred_def_id

    if (!credentialDefinitionId) {
      reject(
        index,
        AnonCredsTrustProblemCode.IssuerNotAuthorized,
        `no sub-proof answers the requested group "${group}"`,
      )
      continue
    }

    try {
      const derived = await agent.anonCredsTrust.deriveCredentialSchema({ credentialDefinitionId })
      const known = {
        credentialDefinitionId,
        issuerDid: derived.issuerId,
        credentialSchemaId: derived.credentialSchemaId,
      }

      if (derived.credentialSchemaId !== requested.credentialSchemaId) {
        reject(
          index,
          AnonCredsTrustProblemCode.IssuerNotAuthorized,
          `${credentialDefinitionId} presents the CredentialSchema ${derived.credentialSchemaId} for the group "${group}", which asks for the CredentialSchema ${requested.credentialSchemaId}`,
          known,
        )
        continue
      }

      if (!derived.issuerId) {
        reject(
          index,
          AnonCredsTrustProblemCode.IssuerNotAuthorized,
          `${credentialDefinitionId} names no issuer`,
          known,
        )
        continue
      }

      candidates.push({
        index,
        group,
        credentialDefinitionId,
        issuerDid: derived.issuerId,
        credentialSchemaId: derived.credentialSchemaId,
        ecosystemDid: derived.ecosystemDid,
        jsonSchemaCredentialId: derived.jsonSchemaCredentialId,
      })
    } catch (error) {
      const cannotCheck =
        !(error instanceof AnonCredsTrustError) || error.reason === AnonCredsTrustErrorReason.Unavailable
      reject(
        index,
        cannotCheck
          ? AnonCredsTrustProblemCode.TrustResolutionUnavailable
          : AnonCredsTrustProblemCode.IssuerNotAuthorized,
        `${error}`,
        { credentialDefinitionId },
      )
    }
  }

  // One read answers every credential of an issuer on a CredentialSchema
  const issuersByCredentialSchema = new Map<number, string[]>()
  for (const { credentialSchemaId, issuerDid } of candidates) {
    issuersByCredentialSchema.set(credentialSchemaId, [
      ...(issuersByCredentialSchema.get(credentialSchemaId) ?? []),
      issuerDid,
    ])
  }

  for (const [credentialSchemaId, issuers] of issuersByCredentialSchema) {
    // A read that fails leaves every issuer of the CredentialSchema unchecked, per
    // [VSA-VTI-FLOW-VERIFY-AC-8]
    let result: UnaccreditedDidsResult
    try {
      result = await agent.anonCredsTrust.findUnaccreditedDids(
        issuers,
        ParticipantRole.Issuer,
        credentialSchemaId,
      )
    } catch (error) {
      logger.error(`The agent cannot read the ISSUER Participants of ${credentialSchemaId}: ${error}`)
      result = { unaccredited: [], unchecked: issuers }
    }

    for (const candidate of candidates) {
      if (candidate.credentialSchemaId !== credentialSchemaId) continue

      const { index, credentialDefinitionId, issuerDid } = candidate
      const known = { credentialDefinitionId, issuerDid, credentialSchemaId }

      if (result.unaccredited.includes(issuerDid)) {
        reject(
          index,
          AnonCredsTrustProblemCode.IssuerNotAuthorized,
          `${issuerDid} holds no active ISSUER Participant for the CredentialSchema ${credentialSchemaId}`,
          known,
        )
      } else if (result.unchecked.includes(issuerDid)) {
        reject(
          index,
          AnonCredsTrustProblemCode.TrustResolutionUnavailable,
          `the agent cannot check the ISSUER Participant of ${issuerDid} for the CredentialSchema ${credentialSchemaId}`,
          known,
        )
      }
    }
  }

  if (rejected.length === 0) {
    // The record keeps the values that the agent verified, so a later read resolves nothing
    record.metadata.set(
      PRESENTED_CREDENTIALS_METADATA,
      candidates.map(({ index: _index, ...presented }): PresentedCredential => presented),
    )
    await agent.didcomm.proofs.update(record)

    emitTrustDecided(agent, record)

    return false
  }

  rejected.sort((a, b) => a.index - b.index)
  record.metadata.set(REJECTED_CREDENTIALS_METADATA, rejected)

  // A credential that is not authorized decides the code. Its cause comes first in the report.
  const notAuthorized = rejected.filter(({ code }) => code === AnonCredsTrustProblemCode.IssuerNotAuthorized)
  const unavailable = rejected.filter(
    ({ code }) => code === AnonCredsTrustProblemCode.TrustResolutionUnavailable,
  )

  await abandonPresentation(
    agent,
    record,
    connection,
    notAuthorized.length > 0
      ? AnonCredsTrustProblemCode.IssuerNotAuthorized
      : AnonCredsTrustProblemCode.TrustResolutionUnavailable,
    [...new Set([...notAuthorized, ...unavailable].map(({ note }) => note))].join('; '),
    logger,
  )

  return true
}

/**
 * Credo emits the change to `presentation-received` before the trust decision runs. The Events API
 * reports that change on this event, per [VSA-VTI-FLOW-VERIFY-AC-7]. The event carries the result
 * of the decision. The function emits nothing for a record that is not in `presentation-received`:
 * Credo reported the state of that record already.
 */
function emitTrustDecided(agent: VsAgent<BaseAgentModules>, record: DidCommProofExchangeRecord): void {
  if (record.state !== DidCommProofState.PresentationReceived) return

  agent.events.emit<VsAgentPresentationTrustDecidedEvent>(agent.context, {
    type: VsAgentEventTypes.PresentationTrustDecided,
    payload: { proofRecord: record.clone(), previousState: DidCommProofState.RequestSent },
  })
}

async function abandonPresentation(
  agent: VsAgent<BaseAgentModules>,
  record: DidCommProofExchangeRecord,
  connection: DidCommConnectionRecord | undefined,
  code: AnonCredsTrustProblemCode,
  description: string,
  logger: BaseLogger,
): Promise<void> {
  logger.warn(`The presentation ${record.id} fails the AnonCreds trust decision (${code}): ${description}`)

  record.isVerified = false
  record.errorMessage = `${code}: ${description}`

  // The Events API reports the change to `presentation-received` with the cause of the failure.
  // It reports the change to `abandoned` after that.
  emitTrustDecided(agent, record)

  // `updateState` emits the state change with `previousState`, per [VSA-VTI-FLOW-VERIFY-AC-7]
  const protocol = agent.dependencyManager
    .resolve(DidCommProofsModuleConfig)
    .proofProtocols.find(candidate => candidate.version === record.protocolVersion)

  if (!protocol) {
    throw new CredoError(
      `No proof protocol registered for protocol version ${record.protocolVersion}, so the presentation ${record.id} cannot end in abandoned`,
    )
  }

  const problemReport = new DidCommPresentationV2ProblemReportMessage({
    description: { code, en: description },
  })
  problemReport.setThread({ threadId: record.threadId, parentThreadId: record.parentThreadId })

  try {
    // An exchange with no connection has no route. Its last two messages give the services.
    const outboundMessageContext = await getOutboundDidCommMessageContext(agent.context, {
      message: problemReport,
      associatedRecord: record,
      connectionRecord: connection,
      lastReceivedMessage: connection
        ? undefined
        : ((await protocol.findPresentationMessage(agent.context, record.id)) ?? undefined),
      lastSentMessage: connection
        ? undefined
        : ((await protocol.findRequestMessage(agent.context, record.id)) ?? undefined),
    })
    await agent.dependencyManager.resolve(DidCommMessageSender).sendMessage(outboundMessageContext)
  } catch (error) {
    logger.error(`The agent cannot send the problem report of presentation ${record.id}: ${error}`)
  }

  await protocol.updateState(agent.context, record, DidCommProofState.Abandoned)
}
