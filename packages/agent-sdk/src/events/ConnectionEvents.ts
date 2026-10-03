import type { VsAgent } from '../agent/VsAgent'
import type { BaseLogger } from '@credo-ts/core'
import type { DidCommConnectionRecord, DidCommFeatureQueryOptions } from '@credo-ts/didcomm'

import {
  DidCommConnectionDidRotatedEvent,
  DidCommConnectionEventTypes,
  DidCommConnectionRepository,
  DidCommConnectionStateChangedEvent,
  DidCommDidExchangeState,
  DidCommDiscoverFeaturesDisclosureReceivedEvent,
  DidCommDiscoverFeaturesEventTypes,
} from '@credo-ts/didcomm'
import {
  ConnectionStateUpdated,
  ExtendedDidExchangeState,
  PresentationState,
  PresentationStateUpdated,
} from '@verana-labs/vs-agent-model'

import { emitVsAgentEvent, VsAgentEventTypes } from './VsAgentEvents'

// TODO: Fix single-use invitations for DIDComm v2 in Credo, then remove this function.
// In Credo, multiUseInvitation: false only sets reusable: false on the OOB record. It does not
// refuse a second connection from a v2 invitation, because v2 has no handshake.
//
// The guard does not apply to an invitation issued under the public DID of this agent. Credo
// binds every first message that a peer sends to the public DID to the newest out-of-band
// record of that DID, also when that record is single-use. A second connection on such a
// record is then not a second use of the invitation: it is a peer that connects to the public
// DID, and a hangup would close a valid connection.
async function discardExtraConnection(
  agent: VsAgent<any>,
  record: DidCommConnectionRecord,
  logger: BaseLogger,
): Promise<boolean> {
  if (!record.outOfBandId || record.didcommVersion !== 'v2') return false

  const outOfBandRecord = await agent.didcomm.oob.findById(record.outOfBandId)
  if (!outOfBandRecord || outOfBandRecord.reusable) return false

  const invitationDid =
    outOfBandRecord.getTags().recipientDid ?? outOfBandRecord.outOfBandInvitation.v2Invitation?.from
  if (invitationDid && (await publicDidsOf(agent)).includes(invitationDid)) return false

  const siblings = await agent.didcomm.connections.findAllByOutOfBandId(record.outOfBandId)
  if (siblings.length < 2) return false

  const accepted: DidCommConnectionRecord = siblings.reduce(
    (oldest: DidCommConnectionRecord, candidate: DidCommConnectionRecord) =>
      candidate.createdAt < oldest.createdAt ||
      (candidate.createdAt.getTime() === oldest.createdAt.getTime() && candidate.id < oldest.id)
        ? candidate
        : oldest,
  )
  if (accepted.id === record.id) return false

  logger.warn(
    `[connection-events] connection ${record.id} is a second use of the single-use invitation ${record.outOfBandId}; closing it`,
  )
  try {
    await agent.didcomm.connections.hangup({ connectionId: record.id })
  } catch (error) {
    logger.warn(`[connection-events] hangup of ${record.id} failed: ${(error as Error).message}`)
  }
  await agent.didcomm.connections.deleteById(record.id)
  return true
}

/**
 * The DIDs under which a peer can address this agent: its public DID and the alternative DIDs
 * of the DID record, such as the parallel did:web of a did:webvh.
 */
async function publicDidsOf(agent: VsAgent<any>): Promise<string[]> {
  if (!agent.did) return []
  const [agentPublicDidRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const alternativeDids = agentPublicDidRecord?.getTag('alternativeDids')
  return [agent.did, ...(Array.isArray(alternativeDids) ? alternativeDids : [])]
}

export const connectionEvents = async (
  agent: VsAgent<any>,
  config: { discoveryOptions?: DidCommFeatureQueryOptions[]; logger: BaseLogger },
) => {
  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async ({ payload }: DidCommConnectionStateChangedEvent) => {
      // an event listener is never awaited, so a rejection here would surface as an
      // unhandled rejection and take the process down
      try {
        const record = payload.connectionRecord

        if (await discardExtraConnection(agent, record, config.logger)) return

        if (record.state === DidCommDidExchangeState.Completed) {
          if (config.discoveryOptions)
            await agent.didcomm.discovery.queryFeatures({
              connectionId: record.id,
              protocolVersion: 'v2',
              queries: config.discoveryOptions,
            })
        }

        // If an out-of-band ID exists, use the invitation to find the thread IDs
        // and identify the invitation that created the connection to update its state.
        if (record.outOfBandId) {
          const invitationRecord = await agent.didcomm.oob.findById(record.outOfBandId)
          const threadIds = invitationRecord?.getTag('invitationRequestsThreadIds') as string[] | undefined
          threadIds?.map(async threadId => {
            const [proofRecord] = await agent.didcomm.proofs.findAllByQuery({ threadId })
            if (!proofRecord) return
            const callbackParameters = proofRecord.metadata.get('_2060/callbackParameters') as
              | { ref?: string; callbackUrl?: string }
              | undefined

            if (
              callbackParameters &&
              callbackParameters.callbackUrl &&
              record.state === DidCommDidExchangeState.RequestReceived
            ) {
              emitVsAgentEvent(
                agent,
                VsAgentEventTypes.PresentationStateUpdated,
                new PresentationStateUpdated({
                  proofExchangeId: proofRecord.id,
                  callbackUrl: callbackParameters.callbackUrl,
                  state: PresentationState.CONNECTED,
                  ref: callbackParameters.ref,
                }),
              )
            }
          })
        }

        // If discovery is enabled, send an empty 'completed' state so that the recipient knows to expect async features.
        const body = new ConnectionStateUpdated({
          connectionId: record.id,
          invitationId: record.outOfBandId,
          state: record.state,
          metadata: config.discoveryOptions ? {} : undefined,
        })

        emitVsAgentEvent(agent, VsAgentEventTypes.ConnectionStateUpdated, body)
      } catch (error) {
        config.logger.error(`[connection-events] state change handler failed: ${(error as Error).message}`)
      }
    },
  )

  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionDidRotated,
    async ({ payload }: DidCommConnectionDidRotatedEvent) => {
      // an event listener is never awaited, so a rejection here would surface as an
      // unhandled rejection and take the process down
      try {
        const record = payload.connectionRecord
        const isTerminationByPeer =
          record.theirDid === undefined && (record.previousTheirDids?.length ?? 0) > 0
        if (!isTerminationByPeer) return

        const body = new ConnectionStateUpdated({
          connectionId: record.id,
          invitationId: record.outOfBandId,
          state: 'terminated',
        })

        emitVsAgentEvent(agent, VsAgentEventTypes.ConnectionStateUpdated, body)
      } catch (error) {
        config.logger.error(`[connection-events] did rotated handler failed: ${(error as Error).message}`)
      }
    },
  )

  agent.events.on(
    DidCommDiscoverFeaturesEventTypes.DisclosureReceived,
    async ({ payload }: DidCommDiscoverFeaturesDisclosureReceivedEvent) => {
      // an event listener is never awaited, so a rejection here would surface as an
      // unhandled rejection and take the process down
      try {
        const record = payload.connection
        payload.disclosures.forEach(item =>
          record.metadata.add(`features-${item.type}`, { [item.id]: item.toJSON() }),
        )
        await agent.context.dependencyManager
          .resolve(DidCommConnectionRepository)
          .update(agent.context, payload.connection)

        const metadata = payload.disclosures?.reduce(
          (acc, item) => {
            acc[item.id] = JSON.stringify(item.toJSON())
            return acc
          },
          {} as Record<string, string>,
        )

        const body = new ConnectionStateUpdated({
          connectionId: record.id,
          invitationId: record.outOfBandId,
          state: ExtendedDidExchangeState.Updated,
          metadata,
        })

        emitVsAgentEvent(agent, VsAgentEventTypes.ConnectionStateUpdated, body)
      } catch (error) {
        config.logger.error(`[connection-events] disclosure handler failed: ${(error as Error).message}`)
      }
    },
  )

  // Auto-accept connections that go to the public did.
  //
  // This listener is the only path that answers a DID Exchange Request sent to the public DID.
  // Credo creates the implicit invitation of such a request with autoAcceptConnection: false, the
  // connection record inherits that value, and the request handler never falls back to the
  // autoAcceptConnections setting of the connections module.
  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async (data: DidCommConnectionStateChangedEvent) => {
      // an event listener is never awaited, so a rejection here would surface as an
      // unhandled rejection and take the process down
      try {
        const record = data.payload.connectionRecord
        config.logger.debug(`Incoming connection event: ${record.state}`)
        if (record.state !== DidCommDidExchangeState.RequestReceived || !record.outOfBandId) return
        const oob = await agent.didcomm.oob.findById(record.outOfBandId)
        const invitationId = oob?.outOfBandInvitation.id
        if (!invitationId || !invitationId.startsWith('did:')) return

        const agentPublicDids = await publicDidsOf(agent)
        if (!agentPublicDids.includes(invitationId)) {
          config.logger.warn(
            `Connection request ${record.id} addresses ${invitationId}, which is none of the DIDs of this agent (${agentPublicDids.join(', ')}). The request stays unanswered.`,
          )
          return
        }
        config.logger.debug(`Incoming connection request for ${invitationId}`)
        await agent.didcomm.connections.acceptRequest(record.id)
        config.logger.debug(`Accepted request ${record.id} for ${invitationId}`)
      } catch (error) {
        config.logger.error(
          `[connection-events] incoming connection handler failed: ${(error as Error).message}`,
        )
      }
    },
  )
}
