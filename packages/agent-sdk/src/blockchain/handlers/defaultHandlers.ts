import { IndexerEventHandler, IndexerHandlerRegistry } from './IndexerHandlerRegistry'
import {
  bumpActiveGfVersion,
  publishVtjscIfOwner,
  removeVtcOnPermissionRevoke,
  upsertCredentialSchema,
  upsertPermission,
  upsertTrustRegistry,
} from './stateMutations'

/**
 * Default handlers for indexer events emitted by the Verana blockchain.
 */
export const defaultHandlers: IndexerEventHandler[] = [
  {
    msg: 'CreateNewTrustRegistry',
    handle: async (activity, ctx) => {
      upsertTrustRegistry(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] CreateNewTrustRegistry entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'UpdateTrustRegistry',
    handle: async (activity, ctx) => {
      upsertTrustRegistry(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] UpdateTrustRegistry entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'AddGovernanceFrameworkDocument',
    handle: async (activity, ctx) => {
      upsertTrustRegistry(ctx.state, activity)
      ctx.agent.config.logger.info(
        `[IndexerWS] AddGovernanceFrameworkDocument entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'IncreaseActiveGFVersion',
    handle: async (activity, ctx) => {
      bumpActiveGfVersion(ctx.state, activity)
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
    msg: 'StartPermissionVP',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, { vpState: 'PENDING' })
      ctx.agent.config.logger.info(
        `[IndexerWS] StartPermissionVP entity=${activity.entity_id} block=${ctx.block_height} — TODO §5.1: progress credential acquisition flow (applicant)`,
      )
    },
  },
  {
    msg: 'RenewPermissionVP',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, { vpState: 'PENDING' })
      ctx.agent.config.logger.info(
        `[IndexerWS] RenewPermissionVP entity=${activity.entity_id} block=${ctx.block_height} — TODO §5.1: progress credential acquisition flow (applicant renewal)`,
      )
    },
  },
  {
    msg: 'SetPermissionVPToValidated',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, { vpState: 'VALIDATED' })
      ctx.agent.config.logger.info(
        `[IndexerWS] SetPermissionVPToValidated entity=${activity.entity_id} block=${ctx.block_height} — TODO §5.1: progress credential acquisition flow (validator)`,
      )
    },
  },
  {
    msg: 'AdjustPermission',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, {
        effectiveUntil: String(activity.changes['effective_until'] ?? ''),
      })
      ctx.agent.config.logger.info(
        `[IndexerWS] AdjustPermission entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'RevokePermission',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, { revoked: true })
      ctx.agent.config.logger.info(
        `[IndexerWS] RevokePermission entity=${activity.entity_id} block=${ctx.block_height}`,
      )
      await removeVtcOnPermissionRevoke(ctx.state, ctx.agent, String(activity.entity_id))
    },
  },
  {
    msg: 'SlashPermissionTrustDeposit',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, { slashed: true })
      ctx.agent.config.logger.info(
        `[IndexerWS] SlashPermissionTrustDeposit entity=${activity.entity_id} block=${ctx.block_height} — TODO §7.2: clean up associated flow state`,
      )
    },
  },
  {
    msg: 'RepayPermissionSlashedTrustDeposit',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, { slashed: false })
      ctx.agent.config.logger.info(
        `[IndexerWS] RepayPermissionSlashedTrustDeposit entity=${activity.entity_id} block=${ctx.block_height}`,
      )
    },
  },
  {
    msg: 'CancelPermissionVPLastRequest',
    handle: async (activity, ctx) => {
      upsertPermission(ctx.state, activity, {})
      ctx.agent.config.logger.info(
        `[IndexerWS] CancelPermissionVPLastRequest entity=${activity.entity_id} block=${ctx.block_height} — TODO §7.2: clean up associated flow state`,
      )
    },
  },
]

export function buildDefaultIndexerHandlerRegistry(): IndexerHandlerRegistry {
  const r = new IndexerHandlerRegistry()
  defaultHandlers.forEach(h => r.register(h))
  return r
}
