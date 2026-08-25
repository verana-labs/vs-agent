import { AgentContext } from '@credo-ts/core'
import {
  VtFlowApi,
  VtFlowErrorCode,
  VtFlowRecord,
  VtFlowRole,
  VtFlowService,
  VtFlowState,
  isVtFlowTerminalState,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { identifySchema } from '@verana-labs/vs-agent-model'

import { VsAgent } from '../../agent/VsAgent'
import { HOLDER_PARTICIPANT_TYPE, ISSUER_PARTICIPANT_TYPE } from '../../types'
import { getEcsSchemas } from '../../utils/data'
import { waitUntilOwnDidIsPubliclyResolvable } from '../../utils/didReadiness'
import { SelfTrDefaults, generateDigestSRI } from '../../utils/setupSelfTr'
import {
  createJsc,
  findMetadataEntry,
  rebindEcsCredentialSchema,
  removeStoredTrustCredential,
  withdrawSelfIssuedEcsCredentials,
} from '../../utils/trustCredentialStore'
import { resolveJsonSchemaCredentialId } from '../../utils/vtjscResolver'
import { VtFlowOrchestrator } from '../../vtFlow'
import { VeranaIndexerService } from '../VeranaIndexerService'
import {
  IndexerActivity,
  ParticipantRole,
  ParticipantState,
  ValidationState,
  VeranaSyncState,
} from '../types'

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

/**
 * Close the onboarding records of a participant that receives no credential.
 *
 * Only a HOLDER takes part in a credential exchange, and the exchange is what moves a record to
 * COMPLETED. An ISSUER, a VERIFIER or a grantor is finished the moment the chain records
 * SetParticipantOPToValidated, so without this both sides would sit at OR_SENT and VALIDATED for
 * ever. The applicant reaches its own record here, because it watches the same chain event.
 */
export async function completeVtFlowRecordsWithoutCredential(
  agent: VsAgent,
  participantId: string,
): Promise<void> {
  const participant = await agent.veranaChain?.getParticipant(Number(participantId))
  if (!participant || participant.role === HOLDER_PARTICIPANT_TYPE) return

  await reconcileVtFlowRecordsForParticipant(
    agent,
    participantId,
    async (record, service, agentContext) => {
      if (record.state === VtFlowState.Completed || isVtFlowTerminalState(record.state)) return null
      await service.markCompleted(agentContext, record.id)
      return 'COMPLETED'
    },
    'Failed to mark COMPLETED',
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
  if (participant?.role !== HOLDER_PARTICIPANT_TYPE || participant.did !== agent.did) return
  if (!agent.publicApiBaseUrl) return

  const agentContext = agent.context
  const service = agentContext.dependencyManager.resolve(VtFlowService)
  const records = await service.findAllByQuery(agentContext, { participantId })
  for (const record of records) {
    if (record.role !== VtFlowRole.Applicant || !record.credentialExchangeRecordId) continue
    try {
      const credentialId = await removeStoredTrustCredential(
        agent,
        agent.publicApiBaseUrl,
        record.credentialExchangeRecordId,
      )
      if (credentialId) {
        agent.config.logger.info(
          `[IndexerWS] Removed linked VP and stored credential ${credentialId} (participant=${participantId})`,
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

/**
 * VSA-VTI-FLOW-OP-REVOKE: an ECS credential anchored against a revoked ISSUER still verifies, but a
 * resolver reports the Participant as REVOKED and the whole DID then fails VS-CONN-VS.
 */
export async function removeSelfIssuedEcsCredentialsIfIssuerRevoked(
  agent: VsAgent,
  participantId: string,
  selfTrDefaults: SelfTrDefaults,
): Promise<void> {
  if (!agent.publicApiBaseUrl) return
  const participant = await agent.veranaChain?.getParticipant(Number(participantId)).catch(() => undefined)
  if (participant?.role !== ISSUER_PARTICIPANT_TYPE || participant.did !== agent.did) return

  try {
    const withdrawn = await withdrawSelfIssuedEcsCredentials(
      agent,
      agent.publicApiBaseUrl,
      participant.id,
      selfTrDefaults,
    )
    for (const jscUrl of withdrawn) {
      agent.config.logger.info(
        `[SelfTR] Withdrew the self-issued ECS credential bound to ${jscUrl} (issuer participant ${participantId})`,
      )
    }
  } catch (e) {
    agent.config.logger.error(
      `[SelfTR] Failed to withdraw the ECS credentials of the revoked ISSUER participant ${participantId}`,
      e as Record<string, unknown>,
    )
  }
}

export async function reconcileVtFlowRecordsOnCancel(agent: VsAgent, participantId: string): Promise<void> {
  const participant = await agent.veranaChain?.getParticipant(Number(participantId)).catch(() => undefined)
  const stillValidated = Number(participant?.opState) === ValidationState.VALIDATED

  await reconcileVtFlowRecordsForParticipant(
    agent,
    participantId,
    async (record, service, agentContext) => {
      if (isVtFlowTerminalState(record.state)) return null
      if (stillValidated && record.credentialExchangeRecordId) {
        if (record.state === VtFlowState.Completed) return null
        await service.updateState(agentContext, record, VtFlowState.Completed)
        return 'COMPLETED'
      }
      await service.updateState(agentContext, record, VtFlowState.TerminatedByApplicant)
      return 'TERMINATED_BY_APPLICANT'
    },
    'Failed to reconcile record after cancel',
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
    await waitUntilOwnDidIsPubliclyResolvable(agent, agent.config.logger)
    const orchestrator = new VtFlowOrchestrator(agent)
    await orchestrator.startOnboardingProcess({ applicantParticipantId })
  } catch (err) {
    agent.config.logger.error(
      `[IndexerWS] StartParticipantOP auto-flow failed: ${(err as Error).message}\n${(err as Error).stack}`,
    )
  }
}

export async function reconcileVtjscPublications(
  agent: VsAgent,
  indexer: VeranaIndexerService,
  corporationId: number,
  selfTrDefaults?: SelfTrDefaults,
): Promise<void> {
  if (!agent.did || !agent.publicApiBaseUrl) return

  const chainId = agent.veranaChain?.getChainId
  if (!chainId) {
    agent.config.logger.warn('[VTJSC] Skipping reconciliation: the agent is not connected to a chain')
    return
  }

  const ecosystems = await indexer.listEcosystems()
  for (const ecosystem of ecosystems.filter(entry => Number(entry.corporation_id) === corporationId)) {
    for (const schema of await indexer.listCredentialSchemas(ecosystem.id)) {
      const [didRecord] = await agent.dids.getCreatedDids({ did: agent.did })
      if (!didRecord) return
      const schemaRef = `vpr:verana:${chainId}:cs:${schema.id}`
      const expectedDigest = generateDigestSRI(schema.json_schema)
      const existingJsc = findMetadataEntry(didRecord, '_vt/jsc', '', schemaRef)
      const existingDigest = (
        existingJsc?.credential?.credentialSubject as { digestSRI?: string } | undefined
      )?.digestSRI
      if (!existingJsc || existingDigest !== expectedDigest) {
        try {
          await createJsc(agent, agent.publicApiBaseUrl, getEcsSchemas(agent.publicApiBaseUrl), {
            schemaBaseId: String(schema.id),
            jsonSchemaRef: schemaRef,
            precomputedDigestSRI: expectedDigest,
          })
          agent.config.logger.info(
            `[VTJSC] Reconciled VTJSC for schema ${schema.id} (ecosystem ${ecosystem.id})`,
          )
        } catch (e) {
          agent.config.logger.error(`[VTJSC] Failed to reconcile VTJSC for schema ${schema.id}`, e as Error)
        }
      }
    }
  }

  if (selfTrDefaults) await reconcileSelfIssuedEcsCredentials(agent, indexer, selfTrDefaults)
}

/**
 * Rebinds and anchors this agent's own ECS credentials.
 *
 * It follows the ISSUER Participant entries the agent holds, not the Ecosystems its Corporation
 * controls: an agent may issue against an Ecosystem that another Corporation owns, and an
 * Ecosystem controller may hold no ISSUER entry at all. An entry is usable only when it names
 * this agent's account as its vs_operator, because the chain accepts the anchoring
 * CreateOrUpdateParticipantSession from no other signer.
 */
async function reconcileSelfIssuedEcsCredentials(
  agent: VsAgent,
  indexer: VeranaIndexerService,
  selfTrDefaults: SelfTrDefaults,
): Promise<void> {
  const chain = agent.veranaChain
  if (!chain || !agent.did || !agent.publicApiBaseUrl) return
  const chainId = chain.getChainId

  // A Participant revoked while the agent was down delivers no event it can still act on. Runs
  // first, so a schema whose ISSUER entry was replaced ends up bound to the new one.
  for (const participantState of [ParticipantState.Revoked, ParticipantState.Slashed]) {
    try {
      const stale = await indexer.listParticipants({
        did: agent.did,
        role: ParticipantRole.Issuer,
        participantState,
      })
      for (const issuer of stale) {
        const withdrawn = await withdrawSelfIssuedEcsCredentials(
          agent,
          agent.publicApiBaseUrl,
          issuer.id,
          selfTrDefaults,
        )
        for (const jscUrl of withdrawn) {
          agent.config.logger.info(
            `[SelfTR] Withdrew the self-issued ECS credential bound to ${jscUrl} (${participantState} issuer participant ${issuer.id})`,
          )
        }
      }
    } catch (e) {
      agent.config.logger.error(
        `[SelfTR] Failed to withdraw the ECS credentials of ${participantState} ISSUER participants`,
        e as Error,
      )
    }
  }

  const issuers = await indexer.listParticipants({
    did: agent.did,
    role: ParticipantRole.Issuer,
    participantState: ParticipantState.Active,
  })

  for (const issuer of issuers) {
    if (issuer.revoked || issuer.slashed || issuer.vs_operator !== chain.address) continue
    try {
      const schema = await indexer.getCredentialSchema(issuer.schema_id)
      const ecsKey = await identifySchema(JSON.parse(schema.json_schema))
      if (!ecsKey) continue
      const jsonSchemaCredentialId = await resolveJsonSchemaCredentialId(agent, indexer, schema.id, chainId)
      await rebindEcsCredentialSchema(
        agent,
        agent.publicApiBaseUrl,
        String(schema.id),
        ecsKey,
        selfTrDefaults,
        jsonSchemaCredentialId,
        issuer.id,
      )
    } catch (e) {
      agent.config.logger.error(
        `[SelfTR] Failed to rebind the ECS credential of schema ${issuer.schema_id}`,
        e as Error,
      )
    }
  }
}

export async function publishVtjscIfOwner(
  state: VeranaSyncState,
  agent: VsAgent,
  schemaEntityId: string,
  agentCorporationId?: number,
): Promise<void> {
  const schema = state.credentialSchemas[schemaEntityId]
  if (!schema) {
    agent.config.logger.warn(`[VTJSC] Schema ${schemaEntityId} not found in state`)
    return
  }

  const ecosystem = state.ecosystems[String(schema.ecosystemId)]
  if (!ecosystem) {
    agent.config.logger.warn(`[VTJSC] Ecosystem ${schema.ecosystemId} not found in state`)
    return
  }

  if (ecosystem.corporationId !== agentCorporationId) {
    agent.config.logger.debug(
      `[VTJSC] Skipping schema ${schema.id}: ecosystem ${ecosystem.id} belongs to corporation ${ecosystem.corporationId}`,
    )
    return
  }

  const chainId = agent.veranaChain?.getChainId
  if (!chainId) {
    agent.config.logger.warn(`[VTJSC] Skipping schema ${schema.id}: the agent is not connected to a chain`)
    return
  }
  const jsonSchemaRef = `vpr:verana:${chainId}:cs:${schema.id}`

  const digestSRI = generateDigestSRI(schema.jsonSchema)

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
