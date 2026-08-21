import type { BaseLogger } from '@credo-ts/core'
import type { VtFlowUnverifiedPeerExemptionHook } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { ECS, classifyEcsSchema } from '@verana-labs/vs-agent-model'

import { VeranaIndexerService } from '../blockchain/VeranaIndexerService'
import { ParticipantDto, ParticipantRole, ParticipantState } from '../blockchain/types'

const EXEMPT_ECS_TYPES: ECS[] = [ECS.ORG, ECS.PERSONA, ECS.SERVICE]
const PENDING_OP_STATE = 'PENDING'

export interface AllowEcsIssuanceExemptionOptions {
  indexer: VeranaIndexerService
  // Resolved per call: a did:webvh agent only knows its SCID-bearing DID once it has initialized.
  ownDid: () => string | undefined
  trustedEcosystemDids?: string[]
  logger?: BaseLogger
}

// VS-CONN-VS exemption: an applicant onboarding for its first ECS credentials cannot be a Verifiable
// Service yet, so the peer is admitted on on-chain evidence instead of on its credentials.
export function allowEcsIssuanceExemption(
  options: AllowEcsIssuanceExemptionOptions,
): VtFlowUnverifiedPeerExemptionHook {
  const { indexer, trustedEcosystemDids } = options
  return async ({ agentContext, peerDid, purpose }) => {
    const logger = options.logger ?? agentContext.config.logger
    const ownDid = options.ownDid()
    if (!ownDid) return false
    try {
      const schemaId = purpose.participantId
        ? await schemaOfPendingOnboarding(indexer, purpose.participantId, peerDid, ownDid)
        : await schemaOfDirectIssuance(indexer, purpose.schemaId, ownDid)
      if (schemaId === undefined) return false

      return await isTrustedEcsSchema(indexer, schemaId, trustedEcosystemDids)
    } catch (error) {
      logger.warn(`[vt-flow] VS-CONN-VS exemption denied to '${peerDid}': ${(error as Error).message}`)
      return false
    }
  }
}

// The applicant paid for a PENDING Participant entry that names this agent as its validator; that
// entry, not a self-issued credential, is what earns the connection.
async function schemaOfPendingOnboarding(
  indexer: VeranaIndexerService,
  participantId: string,
  peerDid: string,
  ownDid: string,
): Promise<number | undefined> {
  const participant = await indexer.getParticipant(participantId)
  if (!participant || participant.did !== peerDid) return undefined
  if (participant.op_state !== PENDING_OP_STATE) return undefined
  if (participant.revoked || participant.slashed) return undefined
  if (participant.validator_participant_id == null) return undefined

  const validator = await indexer.getParticipant(participant.validator_participant_id)
  if (!validator || validator.did !== ownDid) return undefined

  return participant.schema_id
}

// Delegated mode has no Participant entry yet: the only claim to the exemption is that issuing this
// very schema is what this agent is an ISSUER for.
async function schemaOfDirectIssuance(
  indexer: VeranaIndexerService,
  schemaId: string | undefined,
  ownDid: string,
): Promise<number | undefined> {
  if (!schemaId) return undefined
  const id = Number(schemaId)
  if (!Number.isInteger(id)) return undefined

  const issuers = await indexer.listParticipants({
    schemaId: id,
    did: ownDid,
    role: ParticipantRole.Issuer,
  })
  return issuers.some(isUsableIssuer) ? id : undefined
}

async function isTrustedEcsSchema(
  indexer: VeranaIndexerService,
  schemaId: number,
  trustedEcosystemDids?: string[],
): Promise<boolean> {
  const schema = await indexer.getCredentialSchema(schemaId)
  if (!schema || schema.archived) return false

  const ecsType = await classifyEcsSchema(schema.json_schema)
  if (!ecsType || !EXEMPT_ECS_TYPES.includes(ecsType)) return false

  if (!trustedEcosystemDids?.length) return true
  const ecosystem = await indexer.getEcosystem(schema.ecosystem_id)
  return Boolean(ecosystem && !ecosystem.archived && trustedEcosystemDids.includes(ecosystem.did))
}

function isUsableIssuer(participant: ParticipantDto): boolean {
  return (
    !participant.revoked &&
    !participant.slashed &&
    (participant.participant_state === ParticipantState.Active ||
      participant.participant_state === ParticipantState.Future)
  )
}
