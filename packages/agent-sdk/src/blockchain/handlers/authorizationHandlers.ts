import { AuthorizationService } from '../AuthorizationService'
import { IndexerActivity } from '../types'

import { IndexerHandlerContext, IndexerHandlerRegistry } from './IndexerHandlerRegistry'

// VSOA records are only mutated inside these pp msgs (grant on create, expiration update
// on validate, revoke on revoke/slash/cancel); the chain emits no standalone VSOA txs.
const VSOA_GRANT_OR_UPDATE_MSGS = [
  'StartParticipantOP',
  'SelfCreateParticipant',
  'CreateRootParticipant',
  'SetParticipantOPToValidated',
  'SetParticipantEffectiveUntil',
] as const

const VSOA_REVOKE_MSGS = [
  'RevokeParticipant',
  'SlashParticipantTrustDeposit',
  'CancelParticipantOPLastRequest',
] as const

// The six Authorization Notifications from the spec (MOD-DE-MSG-1..6). The indexer does
// not deliver delegation events yet (https://github.com/verana-labs/verana-indexer/issues/320),
// so these stay dormant; the pp triggers above cover the VSOA lifecycle in the meantime.
const DELEGATION_MSGS = [
  'GrantOperatorAuthorization',
  'RevokeOperatorAuthorization',
  'GrantVSOperatorAuthorization',
  'RevokeVSOperatorAuthorization',
  'GrantFeeAllowance',
  'RevokeFeeAllowance',
] as const

/** Call after the default registry is built and overridden so the originals are preserved. */
export function registerAuthorizationHandlers(
  registry: IndexerHandlerRegistry,
  authorizationService: AuthorizationService,
): void {
  const wrap = (msg: string, effect: (activity: IndexerActivity) => Promise<void> | void): void => {
    const original = registry.get(msg)
    registry.register({
      msg,
      handle: async (activity: IndexerActivity, ctx: IndexerHandlerContext) => {
        if (original) await original.handle(activity, ctx)
        try {
          await effect(activity)
        } catch (e) {
          ctx.agent.config.logger.error(
            `[Authorization] cache refresh failed for ${msg}`,
            e as Record<string, unknown>,
          )
        }
      },
    })
  }

  for (const msg of VSOA_GRANT_OR_UPDATE_MSGS) {
    wrap(msg, () => authorizationService.refreshForOperator())
  }

  for (const msg of VSOA_REVOKE_MSGS) {
    wrap(msg, async activity => {
      const participantId = Number(activity.entity_id)
      if (Number.isFinite(participantId)) authorizationService.invalidateParticipant(participantId)
      await authorizationService.refreshForOperator()
    })
  }

  for (const msg of DELEGATION_MSGS) {
    wrap(msg, () => authorizationService.refreshForOperator())
  }
}
