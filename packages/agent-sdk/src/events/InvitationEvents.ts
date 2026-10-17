import type { VsAgent } from '../agent/VsAgent'
import type { BaseLogger } from '@credo-ts/core'

import {
  type DidCommConnectionRecord,
  DidCommConnectionEventTypes,
  type DidCommConnectionStateChangedEvent,
  type DidCommHandshakeReusedEvent,
  DidCommOutOfBandEventTypes,
  DidCommOutOfBandRole,
} from '@credo-ts/didcomm'
import { InvitationStateUpdated } from '@verana-labs/vs-agent-model'

import {
  INVITATION_ID_TAG,
  INVITATION_RECORD_TAG,
  InvitationRepository,
} from '../connections/InvitationRecord'

import { emitVsAgentEvent, VsAgentEventTypes } from './VsAgentEvents'

const acceptingInvitation = new Map<string, Promise<void>>()

async function recordAcceptance(
  agent: VsAgent,
  logger: BaseLogger,
  invitationRecordId: string,
  connection: DidCommConnectionRecord,
  reused: boolean,
): Promise<void> {
  const repository = agent.dependencyManager.resolve(InvitationRepository)
  const record = await repository.findById(agent.context, invitationRecordId)
  const refuse = (reason: string): void =>
    logger.warn(
      `[invitation-events] refused an acceptance of invitation ${invitationRecordId} from ${connection.theirDid}: ${reason}`,
    )

  if (!record) return refuse('the invitation record is deleted')
  // a DID Exchange connection reports several states, and only its first one is the acceptance
  const recorded = record.acceptances.some(
    acceptance => !acceptance.reused && acceptance.connectionId === connection.id,
  )
  if (!reused && recorded) return
  if (!record.reusable && record.state === 'accepted') return refuse('the invitation is single-use')

  const previousState = record.state
  record.state = 'accepted'
  record.acceptances.push({ connectionId: connection.id, reused, acceptedAt: new Date().toISOString() })
  await repository.update(agent.context, record)

  emitVsAgentEvent(
    agent,
    VsAgentEventTypes.InvitationStateUpdated,
    new InvitationStateUpdated({ invitationRecordId, state: record.state, previousState }),
  )
}

/**
 * Records the acceptances of invitation records, per [VSA-DC-OOB-4].
 */
export const invitationEvents = (agent: VsAgent, logger: BaseLogger): void => {
  // one acceptance at a time per invitation record, so concurrent acceptances cannot overwrite each other
  const accept = async (
    invitationRecordId: string,
    connection: DidCommConnectionRecord,
    reused: boolean,
  ): Promise<void> => {
    const run = (acceptingInvitation.get(invitationRecordId) ?? Promise.resolve())
      .then(() => recordAcceptance(agent, logger, invitationRecordId, connection, reused))
      .catch((error: Error) =>
        logger.error(
          `[invitation-events] cannot record an acceptance of invitation ${invitationRecordId}: ${error.message}`,
        ),
      )
    acceptingInvitation.set(invitationRecordId, run)
    await run
    if (acceptingInvitation.get(invitationRecordId) === run) acceptingInvitation.delete(invitationRecordId)
  }

  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async ({ payload }: DidCommConnectionStateChangedEvent) => {
      const invitationRecordId = payload.connectionRecord.getTag(INVITATION_ID_TAG)
      if (typeof invitationRecordId === 'string')
        await accept(invitationRecordId, payload.connectionRecord, false)
    },
  )

  agent.events.on(
    DidCommOutOfBandEventTypes.HandshakeReused,
    async ({ payload }: DidCommHandshakeReusedEvent) => {
      const { outOfBandRecord, connectionRecord } = payload
      if (outOfBandRecord.role !== DidCommOutOfBandRole.Sender) return
      if (outOfBandRecord.getTag(INVITATION_RECORD_TAG) !== true) return
      await accept(outOfBandRecord.id, connectionRecord, true)
    },
  )
}
