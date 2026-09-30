import type { VsAgent } from '../agent/VsAgent'
import type { ParticipantDto } from './types'

import { veranaTypeUrls } from '@verana-labs/verana-types'

import { feeGranterFor, preflightFee } from './feePreflight'

/** DID record writes come in bursts, and the resolver reads the current document, so one trigger covers a burst. */
const COALESCE_WINDOW_MS = 2_000
const pendingByDid = new Map<string, ReturnType<typeof setTimeout>>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// AUTHZ-CHECK-3 step 1, as the flow orchestrator applies it
function isActiveParticipant(participant: ParticipantDto): boolean {
  const now = Date.now()
  if (!participant.effective_from || Date.parse(participant.effective_from) > now) return false
  if (participant.effective_until && Date.parse(participant.effective_until) <= now) return false
  return !participant.revoked && !participant.slashed
}

/**
 * MOD-PP-MSG-15 re-evaluates the DID of the entry, so any active entry of the agent serves.
 * Path 1 of the message needs a `ParticipantAuthorizationRecord`, so an entry with one comes first.
 */
export async function findResolverParticipantId(agent: VsAgent): Promise<number | undefined> {
  const did = agent.did
  if (!did) return undefined
  const participants = await agent.indexer.listParticipants({ did })
  const active = participants.filter(p => p.did === did && isActiveParticipant(p))
  const authorized = active.find(p =>
    agent.authorizationService?.canSign(p.id, veranaTypeUrls.MsgTriggerResolver),
  )
  return (authorized ?? active[0])?.id
}

/**
 * [VSA-VT-LVP-5], [VSA-VPR-TX-4]: sends `TriggerResolver` for one entry, and reports the outcome in
 * the log. A failure is an error line that names the entry, the cause, and the reason: the trust
 * state of the agent stays stale until an operator acts on it. This function never throws.
 */
export async function triggerResolver(agent: VsAgent, participantId: number, cause: string): Promise<void> {
  const chain = agent.veranaChain
  const logger = agent.config.logger
  if (!chain) return
  const target = `TriggerResolver for participant ${participantId} (${cause})`

  const granter = feeGranterFor(agent, participantId)
  const checked = await preflightFee(chain, chain.triggerResolverMsg(participantId), granter)
  if ('reason' in checked) {
    logger.error(`[TriggerResolver] ${target} not sent: ${checked.reason}: ${checked.error}`)
    return
  }
  try {
    const { txHash } = await chain.triggerResolver(participantId, { granter })
    logger.info(`[TriggerResolver] ${target} sent: tx ${txHash}${granter ? `, fee granter ${granter}` : ''}`)
  } catch (error) {
    logger.error(`[TriggerResolver] ${target} failed: ${errorMessage(error)}`)
  }
}

/** `triggerResolver` for the entry that covers the DID of the agent, when it holds one. Never throws. */
export async function triggerResolverForOwnDid(agent: VsAgent, cause: string): Promise<void> {
  if (!agent.veranaChain) return
  let participantId: number | undefined
  try {
    participantId = await findResolverParticipantId(agent)
  } catch (error) {
    agent.config.logger.error(
      `[TriggerResolver] cannot find the Participant entry of ${agent.did} (${cause}): ${errorMessage(error)}`,
    )
    return
  }
  if (participantId === undefined) {
    agent.config.logger.warn(
      `[TriggerResolver] no active Participant entry of ${agent.did}: nothing sent (${cause})`,
    )
    return
  }
  await triggerResolver(agent, participantId, cause)
}

/**
 * Schedules `triggerResolverForOwnDid` after a short window, so that a burst of DID record writes
 * sends one transaction. The call returns at once.
 */
export function scheduleTriggerResolverForOwnDid(agent: VsAgent, cause: string): void {
  const key = agent.did ?? ''
  const pending = pendingByDid.get(key)
  if (pending) clearTimeout(pending)
  const timer = setTimeout(() => {
    pendingByDid.delete(key)
    void triggerResolverForOwnDid(agent, cause)
  }, COALESCE_WINDOW_MS)
  timer.unref?.()
  pendingByDid.set(key, timer)
}
