import { SelfTrDefaults } from '../../utils/setupSelfTr'
import { VeranaIndexerService } from '../VeranaIndexerService'
import { IndexerActivity, ParticipantRole } from '../types'

import { IndexerHandlerContext, IndexerHandlerRegistry } from './IndexerHandlerRegistry'
import { reconcileVtjscPublications } from './stateMutations'

/**
 * Messages that can give this agent the ISSUER participant its own ECS credentials anchor
 * against: an ECOSYSTEM-mode entry becomes usable when the validator validates it, an OPEN-mode
 * entry as soon as its owner creates it.
 */
const ISSUER_READY_MSGS = ['SetParticipantOPToValidated', 'SelfCreateParticipant']

/**
 * Re-runs the ECS credential reconciliation when this agent's own ISSUER participant appears.
 *
 * The Corporation operator provisions that participant out of band, which usually happens after
 * the agent starts. Until it exists the agent cannot anchor the digest of its self-issued ECS
 * credentials, because the chain accepts a CreateOrUpdateParticipantSession only against an
 * active ISSUER entry. These handlers close that gap without a restart.
 */
export function registerSelfIssuanceAnchorHandlers(
  registry: IndexerHandlerRegistry,
  indexer: VeranaIndexerService,
  corporationId: number,
  selfTrDefaults: SelfTrDefaults,
): void {
  // Events arrive in bursts, and each reconciliation writes the DID record, so they run in turn.
  let queue: Promise<void> = Promise.resolve()

  for (const msg of ISSUER_READY_MSGS) {
    const original = registry.get(msg)
    registry.register({
      msg,
      handle: async (activity: IndexerActivity, ctx: IndexerHandlerContext) => {
        if (original) await original.handle(activity, ctx)

        const { agent } = ctx
        if (!agent.did || !agent.veranaChain) return
        try {
          const participant = await indexer.getParticipant(String(activity.entity_id))
          if (participant?.did !== agent.did || participant.role !== ParticipantRole.Issuer) return
        } catch (error) {
          ctx.agent.config.logger.debug(
            `[SelfTR] could not read participant ${activity.entity_id}: ${(error as Error).message}`,
          )
          return
        }

        agent.config.logger.info(
          `[SelfTR] own ISSUER participant ${activity.entity_id} is ready; reconciling the ECS credentials`,
        )
        queue = queue
          .then(() => reconcileVtjscPublications(agent, indexer, corporationId, selfTrDefaults))
          .catch((error: Error) =>
            agent.config.logger.error(`[SelfTR] reconciliation failed: ${error.message}`),
          )
        await queue
      },
    })
  }
}
