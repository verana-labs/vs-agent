import { IndexerEventHandler, IndexerHandlerRegistry } from './IndexerHandlerRegistry'
import {
  markVtFlowRecordsValidated,
  publishVtjscIfOwner,
  setVtFlowRecordsParticipantRevoked,
  setVtFlowRecordsParticipantSlashed,
  startParticipantOPAutoFlow,
  terminateVtFlowRecordsByApplicant,
} from './stateMutations'

/**
 * Default business reactions for indexer events emitted by the Verana blockchain.
 *
 * State-sync bookkeeping is handled separately by `applyStateMutation` and always runs, so these
 * handlers can be overridden/disabled by application developers without breaking the sync state.
 */
export const defaultHandlers: IndexerEventHandler[] = [
  {
    msg: 'CreateNewEcosystem',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateNewEcosystem entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'UpdateEcosystem',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] UpdateEcosystem entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'AddGovernanceFrameworkDocument',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] AddGovernanceFrameworkDocument entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'IncreaseActiveGFVersion',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] IncreaseActiveGFVersion entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'CreateNewCredentialSchema',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateNewCredentialSchema entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await publishVtjscIfOwner(ctx.state, ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'UpdateCredentialSchema',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] UpdateCredentialSchema entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'ArchiveCredentialSchema',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] ArchiveCredentialSchema entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'StartParticipantOP',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] StartParticipantOP entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await startParticipantOPAutoFlow(ctx.agent, activity)
    },
  },
  {
    msg: 'RenewParticipantOP',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] RenewParticipantOP entity=${activity.entity_id} block=${ctx.blockHeight} — TODO §5.1: progress credential acquisition flow (applicant renewal)`,
      )
    },
  },
  {
    msg: 'SetParticipantOPToValidated',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] SetParticipantOPToValidated participant=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await markVtFlowRecordsValidated(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'SetParticipantEffectiveUntil',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] SetParticipantEffectiveUntil entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'RevokeParticipant',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] RevokeParticipant entity=${activity.entity_id} block=${ctx.blockHeight} — TODO §7.2: remove linked VP from DID doc + delete credential`,
      )
      await setVtFlowRecordsParticipantRevoked(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'SlashParticipantTrustDeposit',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] SlashParticipantTrustDeposit participant=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await setVtFlowRecordsParticipantSlashed(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'RepayParticipantSlashedTrustDeposit',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] RepayParticipantSlashedTrustDeposit entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'CancelParticipantOPLastRequest',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] CancelParticipantOPLastRequest participant=${activity.entity_id} block=${ctx.blockHeight}`,
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
