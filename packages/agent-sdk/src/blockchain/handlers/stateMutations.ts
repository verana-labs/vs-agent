import { AgentContext } from '@credo-ts/core'
import {
  VtFlowApi,
  VtFlowErrorCode,
  VtFlowRecord,
  VtFlowRole,
  VtFlowService,
  VtFlowState,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { computeSchemaDigest } from '@verana-labs/vs-agent-model'

import { VsAgent } from '../../agent/VsAgent'
import { getEcsSchemas } from '../../utils/data'
import { createJsc, removeTrustCredential } from '../../utils/trustCredentialStore'
import { VtFlowOrchestrator } from '../../vtFlow'
import { IndexerActivity, VeranaSyncState } from '../types'

const DEFAULT_CHAIN_ID = 'vna-testnet-1'
const PARTICIPANT_ROLE_HOLDER = 6

export function applyStateMutation(state: VeranaSyncState, activity: IndexerActivity): void {
  switch (activity.msg) {
    case 'CreateNewEcosystem':
    case 'UpdateEcosystem':
    case 'ArchiveEcosystem':
    case 'AddGovernanceFrameworkDocument':
      upsertEcosystem(state, activity)
      break
    case 'IncreaseActiveGFVersion':
      bumpActiveVersion(state, activity)
      break
    case 'CreateNewCredentialSchema':
    case 'UpdateCredentialSchema':
    case 'ArchiveCredentialSchema':
      upsertCredentialSchema(state, activity)
      break
    case 'StartParticipantOP':
    case 'RenewParticipantOP':
      upsertParticipant(state, activity, { opState: 'PENDING' })
      break
    case 'CreateRootParticipant':
    case 'SelfCreateParticipant':
      upsertParticipant(state, activity, {})
      break
    case 'SetParticipantOPToValidated':
      upsertParticipant(state, activity, { opState: 'VALIDATED' })
      break
    case 'SetParticipantEffectiveUntil':
      upsertParticipant(state, activity, {
        effectiveUntil: String(activity.changes['effective_until'] ?? ''),
      })
      break
    case 'RevokeParticipant':
      upsertParticipant(state, activity, { revoked: true })
      break
    case 'SlashParticipantTrustDeposit':
      upsertParticipant(state, activity, { slashed: true })
      break
    case 'RepayParticipantSlashedTrustDeposit':
      upsertParticipant(state, activity, { slashed: false })
      break
    case 'CancelParticipantOPLastRequest':
      upsertParticipant(state, activity, {})
      break
  }
}

export function upsertEcosystem(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.ecosystems[id]

  const archivedRaw = c['archived']
  const archived =
    archivedRaw !== undefined ? archivedRaw !== null && archivedRaw !== false : (existing?.archived ?? false)

  state.ecosystems[id] = {
    id: Number(id),
    did: String(c['did'] ?? existing?.did ?? ''),
    corporationId: Number(c['corporation_id'] ?? existing?.corporationId ?? 0),
    archived,
    activeVersion: existing?.activeVersion,
    lastModifiedBlock: block,
  }
}

export function bumpActiveVersion(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const existing = state.ecosystems[id]

  state.ecosystems[id] = {
    id: Number(id),
    did: String(existing?.did ?? ''),
    corporationId: existing?.corporationId ?? 0,
    archived: existing?.archived ?? false,
    activeVersion: (existing?.activeVersion ?? 0) + 1,
    lastModifiedBlock: block,
  }
}

export function upsertCredentialSchema(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.credentialSchemas[id]

  const archivedRaw = c['archived']
  const archived =
    archivedRaw !== undefined ? archivedRaw !== null && archivedRaw !== false : (existing?.archived ?? false)

  state.credentialSchemas[id] = {
    id: Number(id),
    ecosystemId: Number(c['ecosystem_id'] ?? existing?.ecosystemId ?? 0),
    jsonSchema: String(c['json_schema'] ?? existing?.jsonSchema ?? ''),
    issuerMode: c['issuer_onboarding_mode'] ? String(c['issuer_onboarding_mode']) : existing?.issuerMode,
    verifierMode: c['verifier_onboarding_mode']
      ? String(c['verifier_onboarding_mode'])
      : existing?.verifierMode,
    archived,
    lastModifiedBlock: block,
  }
}

export function upsertParticipant(
  state: VeranaSyncState,
  activity: IndexerActivity,
  overrides: {
    opState?: string
    revoked?: boolean
    slashed?: boolean
    effectiveUntil?: string
  } = {},
): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.participants[id]

  state.participants[id] = {
    id: Number(id),
    schemaId: Number(c['schema_id'] ?? existing?.schemaId ?? 0),
    did: String(c['did'] ?? existing?.did ?? ''),
    role: Number(c['role'] ?? existing?.role ?? 0),
    opState: overrides.opState ?? String(c['op_state'] ?? existing?.opState ?? ''),
    effectiveUntil: overrides.effectiveUntil ?? existing?.effectiveUntil ?? '',
    revoked: overrides.revoked ?? existing?.revoked ?? false,
    slashed: overrides.slashed ?? existing?.slashed ?? false,
    lastModifiedBlock: block,
  }
}

export async function reconcileVtFlowRecordsForParticipant(
  agent: VsAgent,
  participantId: string,
  reconcile: (
    record: VtFlowRecord,
    service: VtFlowService,
    agentContext: AgentContext,
  ) => Promise<string | null>,
  errorLabel: string,
): Promise<void> {
  const agentContext = agent.context
  const service = agentContext.dependencyManager.resolve(VtFlowService)
  const records = await service.findAllByQuery(agentContext, { participantId })

  for (const record of records) {
    try {
      const transitionedTo = await reconcile(record, service, agentContext)
      if (transitionedTo) {
        agent.config.logger.info(
          `[IndexerWS] VtFlowRecord ${record.id} transitioned to ${transitionedTo} (participant=${participantId})`,
        )
      }
    } catch (e) {
      agent.config.logger.error(
        `[IndexerWS] ${errorLabel} for record ${record.id}`,
        e as Record<string, unknown>,
      )
    }
  }
}

export async function markVtFlowRecordsValidated(agent: VsAgent, participantId: string): Promise<void> {
  await reconcileVtFlowRecordsForParticipant(
    agent,
    participantId,
    async (record, service, agentContext) => {
      if (record.state !== VtFlowState.Validating && record.state !== VtFlowState.OobPending) {
        return null
      }
      await service.markValidated(agentContext, record.id)
      return 'VALIDATED'
    },
    'Failed to markValidated',
  )
}

export async function setVtFlowRecordsParticipantRevoked(
  agent: VsAgent,
  participantId: string,
): Promise<void> {
  await reconcileVtFlowRecordsForParticipant(
    agent,
    participantId,
    async (record, service, agentContext) => {
      if (
        record.state === VtFlowState.ParticipantRevoked ||
        record.state === VtFlowState.ParticipantSlashed
      ) {
        return null
      }
      await agentContext.dependencyManager.resolve(VtFlowApi).terminateByChainEvent({
        vtFlowRecordId: record.id,
        code: VtFlowErrorCode.ParticipantRevoked,
        state: VtFlowState.ParticipantRevoked,
        enDescription: `Participant ${participantId} has been revoked on-chain`,
      })
      return 'PARTICIPANT_REVOKED'
    },
    'Failed to set PARTICIPANT_REVOKED',
  )
}

export async function setVtFlowRecordsParticipantSlashed(
  agent: VsAgent,
  participantId: string,
): Promise<void> {
  await reconcileVtFlowRecordsForParticipant(
    agent,
    participantId,
    async (record, service, agentContext) => {
      if (
        record.state === VtFlowState.ParticipantSlashed ||
        record.state === VtFlowState.ParticipantRevoked
      ) {
        return null
      }
      await agentContext.dependencyManager.resolve(VtFlowApi).terminateByChainEvent({
        vtFlowRecordId: record.id,
        code: VtFlowErrorCode.ParticipantSlashed,
        state: VtFlowState.ParticipantSlashed,
        enDescription: `Participant ${participantId} trust deposit has been slashed on-chain`,
      })
      return 'PARTICIPANT_SLASHED'
    },
    'Failed to set PARTICIPANT_SLASHED',
  )
}

/** VSA-VTI-FLOW-OP-REVOKE: a revoked/slashed HOLDER's credential is gone; drop its linked VP and stored VTC. */
export async function removeHolderTrustCredentialIfRevoked(
  agent: VsAgent,
  participantId: string,
): Promise<void> {
  const participant = await agent.veranaChain?.getParticipant(Number(participantId)).catch(() => undefined)
  if (participant?.role !== PARTICIPANT_ROLE_HOLDER || participant.did !== agent.did) return
  if (!agent.publicApiBaseUrl) return

  const agentContext = agent.context
  const service = agentContext.dependencyManager.resolve(VtFlowService)
  const records = await service.findAllByQuery(agentContext, { participantId })
  for (const record of records) {
    if (record.role !== VtFlowRole.Applicant || !record.credentialExchangeRecordId) continue
    try {
      const formatData = await agent.didcomm.credentials.getFormatData(record.credentialExchangeRecordId)
      const credentialId = (
        (formatData.credential as { jsonld?: { id?: string } } | undefined)?.jsonld as
          | { id?: string }
          | undefined
      )?.id
      if (!credentialId) continue
      const removed = await removeTrustCredential(agent, agent.publicApiBaseUrl, credentialId, '_vt/vtc')
      if (removed) {
        agent.config.logger.info(
          `[IndexerWS] Removed linked VP and stored credential ${credentialId} (participant=${participantId})`,
        )
      } else {
        agent.config.logger.debug(
          `[IndexerWS] No stored trust credential matched ${credentialId} (participant=${participantId})`,
        )
      }
    } catch (e) {
      agent.config.logger.error(
        `[IndexerWS] Failed to remove credential for revoked HOLDER participant ${participantId}`,
        e as Record<string, unknown>,
      )
    }
  }
}

export async function terminateVtFlowRecordsByApplicant(
  agent: VsAgent,
  participantId: string,
): Promise<void> {
  await reconcileVtFlowRecordsForParticipant(
    agent,
    participantId,
    async (record, service, agentContext) => {
      await service.updateState(agentContext, record, VtFlowState.TerminatedByApplicant)
      return 'TERMINATED_BY_APPLICANT'
    },
    'Failed to terminate record',
  )
}

export async function startParticipantOPAutoFlow(agent: VsAgent, activity: IndexerActivity): Promise<void> {
  const chain = agent.veranaChain
  if (!chain) return
  const applicantParticipantId = Number(activity.entity_id)
  if (!Number.isFinite(applicantParticipantId)) return
  const holderParticipant = await chain.getParticipant(applicantParticipantId)
  if (!holderParticipant || holderParticipant.did !== agent.did) return
  try {
    const orchestrator = new VtFlowOrchestrator(agent)
    await orchestrator.startOnboardingProcess({ applicantParticipantId })
  } catch (err) {
    agent.config.logger.error(
      `[IndexerWS] StartParticipantOP auto-flow failed: ${(err as Error).message}\n${(err as Error).stack}`,
    )
  }
}

export async function publishVtjscIfOwner(
  state: VeranaSyncState,
  agent: VsAgent,
  schemaEntityId: string,
): Promise<void> {
  const schema = state.credentialSchemas[schemaEntityId]
  if (!schema) {
    agent.config.logger.warn(`[VTJSC] Schema ${schemaEntityId} not found in state`)
  }

  const ecosystem = state.ecosystems[String(schema.ecosystemId)]
  if (!ecosystem) {
    agent.config.logger.warn(`[VTJSC] Ecosystem ${schema.ecosystemId} not found in state`)
  }

  const chainId = agent.veranaChain?.getChainId ?? DEFAULT_CHAIN_ID
  const jsonSchemaRef = `vpr:verana:${chainId}/cs/v1/js/${schema.id}`

  let digestSRI: string
  try {
    digestSRI = await computeSchemaDigest(JSON.parse(schema.jsonSchema))
  } catch (e) {
    agent.config.logger.error(`[VTJSC] Failed to parse/digest schema ${schemaEntityId}`, e as Error)
    return
  }

  try {
    await createJsc(agent, agent.publicApiBaseUrl, getEcsSchemas(agent.publicApiBaseUrl), {
      schemaBaseId: String(schema.id),
      jsonSchemaRef,
      precomputedDigestSRI: digestSRI,
    })
    agent.config.logger.info(
      `[VTJSC] Published VTJSC for schema ${schema.id} (Ecosystem ${schema.ecosystemId}) at block ${state.lastBlockHeight}`,
    )
  } catch (e) {
    agent.config.logger.error(`[VTJSC] Failed to publish VTJSC for schema ${schema.id}`, e as Error)
  }
}
