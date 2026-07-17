import { AuthorizationService } from '../AuthorizationService'
import { IndexerActivity } from '../types'

import { IndexerHandlerContext, IndexerHandlerRegistry } from './IndexerHandlerRegistry'

// VSOA records change inside these pp msgs and, once https://github.com/verana-labs/verana-indexer/pull/324
// lands, the forwarded de keeper events.
const REFRESH_MSGS = [
  'StartParticipantOP',
  'SelfCreateParticipant',
  'CreateRootParticipant',
  'SetParticipantOPToValidated',
  'SetParticipantEffectiveUntil',
  'GrantVSOperatorAuthorization',
  'UpdateVSOperatorAuthorization',
  'GrantOperatorAuthorization',
  'RevokeOperatorAuthorization',
] as const

// entity_id is the participant id on both the pp events and the de RevokeVSOperatorAuthorization event.
const REVOKE_MSGS = [
  'RevokeParticipant',
  'SlashParticipantTrustDeposit',
  'CancelParticipantOPLastRequest',
  'RevokeVSOperatorAuthorization',
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

  for (const msg of REFRESH_MSGS) {
    wrap(msg, () => authorizationService.refreshForOperator())
  }

  for (const msg of REVOKE_MSGS) {
    wrap(msg, async activity => {
      const participantId = Number(activity.entity_id)
      if (Number.isFinite(participantId)) authorizationService.invalidateParticipant(participantId)
      await authorizationService.refreshForOperator()
    })
  }
}
