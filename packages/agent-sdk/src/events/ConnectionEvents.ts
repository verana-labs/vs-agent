import type { VsAgent } from '../agent/VsAgent'
import type { BaseLogger } from '@credo-ts/core'
import type { DidCommFeatureQueryOptions } from '@credo-ts/didcomm'

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
  PresentationStatus,
  PresentationStateUpdated,
} from '@verana-labs/vs-agent-model'

import { emitVsAgentEvent, VsAgentEventTypes } from './VsAgentEvents'

export const connectionEvents = async (
  agent: VsAgent<any>,
  config: { discoveryOptions?: DidCommFeatureQueryOptions[]; logger: BaseLogger },
) => {
  // Get the first record matching agent's DID and obtain all alternatives for it
  const [agentPublicDidRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const alternativeDids = agentPublicDidRecord?.getTag('alternativeDids')
  const agentPublicDids = [agent.did, ...(Array.isArray(alternativeDids) ? alternativeDids : [])]

  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async ({ payload }: DidCommConnectionStateChangedEvent) => {
      const record = payload.connectionRecord

      if (record.outOfBandId && !record.getTag('parentConnectionId')) {
        const outOfBandRecord = await agent.didcomm.oob.findById(record.outOfBandId)
        const parentConnectionId = outOfBandRecord?.getTag('parentConnectionId') as string

        // Tag connection with its parent
        if (parentConnectionId) {
          record.setTag('parentConnectionId', parentConnectionId)
          await agent.context.dependencyManager
            .resolve(DidCommConnectionRepository)
            .update(agent.context, record)
        }
      }

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
                status: PresentationStatus.CONNECTED,
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
    },
  )

  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionDidRotated,
    async ({ payload }: DidCommConnectionDidRotatedEvent) => {
      const record = payload.connectionRecord
      const isTerminationByPeer = record.theirDid === undefined && (record.previousTheirDids?.length ?? 0) > 0
      if (!isTerminationByPeer) return

      const body = new ConnectionStateUpdated({
        connectionId: record.id,
        invitationId: record.outOfBandId,
        state: 'terminated',
      })

      emitVsAgentEvent(agent, VsAgentEventTypes.ConnectionStateUpdated, body)
    },
  )

  agent.events.on(
    DidCommDiscoverFeaturesEventTypes.DisclosureReceived,
    async ({ payload }: DidCommDiscoverFeaturesDisclosureReceivedEvent) => {
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
    },
  )

  // Auto-accept connections that go to the public did
  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async (data: DidCommConnectionStateChangedEvent) => {
      config.logger.debug(`Incoming connection event: ${data.payload.connectionRecord.state}`)
      const outOfBandId = data.payload.connectionRecord.outOfBandId
      if (!outOfBandId) return
      const oob = await agent.didcomm.oob.findById(outOfBandId)
      if (
        agentPublicDids.includes(oob?.outOfBandInvitation.id) &&
        data.payload.connectionRecord.state === DidCommDidExchangeState.RequestReceived
      ) {
        config.logger.debug(`Incoming connection request for ${agent.did}`)
        await agent.didcomm.connections.acceptRequest(data.payload.connectionRecord.id)
        config.logger.debug(`Accepted request for ${agent.did}`)
      }
    },
  )
}
