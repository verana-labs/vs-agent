import { IndexerEventHandler, IndexerHandlerRegistry } from './IndexerHandlerRegistry'
import {
  markVtFlowRecordsValidated,
  publishVtjscIfOwner,
  removeHolderTrustCredentialIfRevoked,
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
        `[IndexerWS] RenewParticipantOP entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await startParticipantOPAutoFlow(ctx.agent, activity)
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
        `[IndexerWS] RevokeParticipant entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await removeHolderTrustCredentialIfRevoked(ctx.agent, String(activity.entity_id))
      await setVtFlowRecordsParticipantRevoked(ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'SlashParticipantTrustDeposit',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] SlashParticipantTrustDeposit participant=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      await removeHolderTrustCredentialIfRevoked(ctx.agent, String(activity.entity_id))
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
  {
    msg: 'CreateNewCorporation',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateNewCorporation entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'UpdateCorporation',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] UpdateCorporation entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
      if (activity.changes['did'] != null) {
        ctx.agent.config.logger.warn(
          `[IndexerWS] Corporation ${activity.entity_id} was updated; if its DID rotated, per-DID indexer subscriptions may need to be re-established`,
        )
      }
    },
  },
  {
    msg: 'ArchiveEcosystem',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] ArchiveEcosystem entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'CreateRootParticipant',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateRootParticipant entity=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'SelfCreateParticipant',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] SelfCreateParticipant participant=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
  {
    msg: 'TriggerResolver',
    handle: async (activity, ctx) => {
      ctx.agent.config.logger.info(
        `[IndexerWS] TriggerResolver participant=${activity.entity_id} block=${ctx.blockHeight}`,
      )
    },
  },
]

export function buildDefaultIndexerHandlerRegistry(): IndexerHandlerRegistry {
  const r = new IndexerHandlerRegistry()
  defaultHandlers.forEach(h => r.register(h))
  return r
}
