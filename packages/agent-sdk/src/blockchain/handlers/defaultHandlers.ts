import { IndexerEventHandler, IndexerHandlerRegistry } from './IndexerHandlerRegistry'
import {
  bumpActiveVersion,
  markVtFlowRecordsValidated,
  publishVtjscIfOwner,
  setVtFlowRecordsParticipantRevoked,
  setVtFlowRecordsParticipantSlashed,
  startParticipantOPAutoFlow,
  terminateVtFlowRecordsByApplicant,
  upsertCredentialSchema,
  upsertEcosystem,
  upsertParticipant,
} from './stateMutations'

/**
 * Default handlers for indexer events emitted by the Verana blockchain.
 */
export const defaultHandlers: IndexerEventHandler[] = [
  {
    msg: 'CreateNewEcosystem',
    handle: async (activity, ctx) => {
      upsertEcosystem(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateNewEcosystem entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'UpdateEcosystem',
    handle: async (activity, ctx) => {
      upsertEcosystem(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] UpdateEcosystem entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'AddGovernanceFrameworkDocument',
    handle: async (activity, ctx) => {
      upsertEcosystem(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] AddGovernanceFrameworkDocument entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'IncreaseActiveGFVersion',
    handle: async (activity, ctx) => {
      bumpActiveVersion(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] IncreaseActiveGFVersion entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'CreateNewCredentialSchema',
    handle: async (activity, ctx) => {
      upsertCredentialSchema(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateNewCredentialSchema entity=${activity.entity_id} block=${ctx.block_height}`,
      )
      await publishVtjscIfOwner(ctx.state, ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'UpdateCredentialSchema',
    handle: async (activity, ctx) => {
      upsertCredentialSchema(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] UpdateCredentialSchema entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'ArchiveCredentialSchema',
    handle: async (activity, ctx) => {
      upsertCredentialSchema(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] ArchiveCredentialSchema entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'StartParticipantOP',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, { opState: 'PENDING' })
      ctx.agent.config.logger.info(
        `[IndexerWS] StartParticipantOP entity=${activity.entity_id} block=${ctx.block_height}`,
      )

      await startParticipantOPAutoFlow(ctx.agent, activity)
    },
  },
  {
    msg: 'RenewParticipantOP',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, { opState: 'PENDING' })
      ctx.agent.config.logger.info(
        `[IndexerWS] RenewParticipantOP entity=${activity.entity_id} block=${ctx.block_height} — TODO §5.1: progress credential acquisition flow (applicant renewal)`,
      )
    },
  },
  {
    msg: 'SetParticipantOPToValidated',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, { opState: 'VALIDATED' })
      ctx.agent.config.logger.info(
        `[IndexerWS] SetParticipantOPToValidated participant=${activity.entity_id} block=${ctx.block_height}`,
      )
      await markVtFlowRecordsValidated(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'SetParticipantEffectiveUntil',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, {
        effectiveUntil: String(activity.changes['effective_until'] ?? ''),
      })
      ctx.agent.config.logger.info(
        `[IndexerWS] SetParticipantEffectiveUntil entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'RevokeParticipant',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, { revoked: true })
      ctx.agent.config.logger.info(
        `[IndexerWS] RevokeParticipant entity=${activity.entity_id} block=${ctx.block_height} — TODO §7.2: remove linked VP from DID doc + delete credential`,
      )
      await setVtFlowRecordsParticipantRevoked(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'SlashParticipantTrustDeposit',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, { slashed: true })
      ctx.agent.config.logger.info(
        `[IndexerWS] SlashParticipantTrustDeposit participant=${activity.entity_id} block=${ctx.block_height}`,
      )
      await setVtFlowRecordsParticipantSlashed(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'RepayParticipantSlashedTrustDeposit',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, { slashed: false })
      ctx.agent.config.logger.info(
        `[IndexerWS] RepayParticipantSlashedTrustDeposit entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'CancelParticipantOPLastRequest',
    handle: async (activity, ctx) => {
      upsertParticipant(ctx.state, activity, {})
      ctx.agent.config.logger.info(
        `[IndexerWS] CancelParticipantOPLastRequest participant=${activity.entity_id} block=${ctx.block_height}`,
      )
      await terminateVtFlowRecordsByApplicant(ctx.agent, String(activity.entity_id))
    },
  },
]

export function buildDefaultIndexerHandlerRegistry(): IndexerHandlerRegistry {
  const r = new IndexerHandlerRegistry()
  defaultHandlers.forEach(h => r.register(h))
  return r
}
