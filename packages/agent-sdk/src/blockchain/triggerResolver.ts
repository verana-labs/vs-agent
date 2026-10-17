import type { VsAgent } from '../agent/VsAgent'
import { ParticipantRole } from './types'

import { veranaTypeUrls } from '@verana-labs/verana-types'

import { FeePreflightError, feeGranterFor } from './feePreflight'

/** DID record writes come in bursts, and the resolver reads the current document, so one trigger covers a burst. */
const COALESCE_WINDOW_MS = 2_000
const pendingByDid = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => Promise<void> }>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * [VSA-VPR-TX-5]: an active HOLDER entry of the agent whose `ParticipantAuthorizationRecord` lists
 * `TriggerResolver`. Path 1 of MOD-PP-MSG-15 needs that record, and only a HOLDER record can list
 * the message (MOD-PP-MSG-1-1, MOD-PP-MSG-14-1), so any other entry always fails on chain.
 */
export async function findResolverParticipantId(agent: VsAgent): Promise<number | undefined> {
  const did = agent.did
  if (!did) return undefined
  const participants = await agent.indexer.listParticipants({ did, role: ParticipantRole.Holder })
  return participants.find(
    p =>
      p.did === did &&
      p.role === ParticipantRole.Holder &&
      agent.authorizationService?.canSign(p, veranaTypeUrls.MsgTriggerResolver),
  )?.id
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
  try {
    // the fee pre-flight of the broadcast names the payer it could not charge
    const { txHash } = await chain.triggerResolver(participantId, { granter })
    logger.info(`[TriggerResolver] ${target} sent: tx ${txHash}${granter ? `, fee granter ${granter}` : ''}`)
  } catch (error) {
    if (error instanceof FeePreflightError) {
      logger.error(`[TriggerResolver] ${target} not sent: ${error.reason}: ${error.message}`)
      return
    }
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
      `[TriggerResolver] no active HOLDER entry of ${agent.did} whose authorization lists TriggerResolver: nothing sent (${cause})`,
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
  if (pending) clearTimeout(pending.timer)
  const send = async () => {
    pendingByDid.delete(key)
    await triggerResolverForOwnDid(agent, cause)
  }
  const timer = setTimeout(() => void send(), COALESCE_WINDOW_MS)
  // the window must not hold a shutdown open; `flushPendingTriggerResolvers` sends what it holds
  timer.unref?.()
  pendingByDid.set(key, { timer, send })
}

/**
 * Sends every trigger that a coalescing window still holds, and waits for it. The agent calls this
 * when it shuts down: [IDX-VT-EVAL-3] makes the trigger the only signal of a publication change, so a
 * trigger the window still holds at exit would leave the trust state of the agent stale for good.
 */
export async function flushPendingTriggerResolvers(): Promise<void> {
  const pending = [...pendingByDid.values()]
  pendingByDid.clear()
  for (const { timer, send } of pending) {
    clearTimeout(timer)
    await send()
  }
}
