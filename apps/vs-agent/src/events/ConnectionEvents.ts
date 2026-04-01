import type { ServerConfig, VsAgent } from '../utils'
import type { DidCommAgentModules } from '@verana-labs/vs-agent-sdk'

import {
  DidCommConnectionEventTypes,
  DidCommConnectionRepository,
  DidCommConnectionStateChangedEvent,
  DidCommDidExchangeState,
  DidCommDiscoverFeaturesDisclosureReceivedEvent,
  DidCommDiscoverFeaturesEventTypes,
  DidCommEventTypes,
  DidCommHangupMessage,
  DidCommMessageProcessedEvent,
} from '@credo-ts/didcomm'
import { ConnectionStateUpdated, ExtendedDidExchangeState } from '@verana-labs/vs-agent-model'

import { PresentationStatus, sendPresentationCallbackEvent } from './CallbackEvent'
import { sendWebhookEvent } from './WebhookEvent'

export const connectionEvents = async (agent: VsAgent<DidCommAgentModules>, config: ServerConfig) => {
  // Get the first record matching agent's DID and obtain all alternatives for it
  const [agentPublicDidRecord] = await agent.dids.getCreatedDids({ did: agent.did })
  const alternativeDids = agentPublicDidRecord?.getTag('alternativeDids')
  const agentPublicDids = [agent.did, ...(Array.isArray(alternativeDids) ? alternativeDids : [])]

  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async ({ payload }: DidCommConnectionStateChangedEvent) => {
      const record = payload.connectionRecord

      if (record.outOfBandId && !record.getTag('parentConnectionId')) {
        const outOfBandRecord = await agent.didcomm.oob.getById(record.outOfBandId)
        const parentConnectionId = outOfBandRecord.getTag('parentConnectionId') as string

        // Tag connection with its parent
        if (parentConnectionId) {
          record.setTag('parentConnectionId', parentConnectionId)
          await agent.context.dependencyManager
            .resolve(DidCommConnectionRepository)
            .update(agent.context, record)
        }
      }

      if (record.state === DidCommDidExchangeState.Completed) {
        await agent.modules.userProfile.requestUserProfile({ connectionId: record.id })
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
            await sendPresentationCallbackEvent({
              proofExchangeId: proofRecord.id,
              callbackUrl: callbackParameters.callbackUrl,
              status: PresentationStatus.CONNECTED,
              logger: config.logger,
              ref: callbackParameters.ref,
            })
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

      await sendWebhookEvent(config.webhookUrl + '/connection-state-updated', body, config.logger)
    },
  )

  // When a hangup message is received for a given connection, it will be effectively terminated. VS Agent controller
  // will be notified about this 'termination' status
  agent.events.on(
    DidCommEventTypes.DidCommMessageProcessed,
    async ({ payload }: DidCommMessageProcessedEvent) => {
      const { message, connection } = payload

      if (message.type === DidCommHangupMessage.type.messageTypeUri && connection) {
        const body = new ConnectionStateUpdated({
          connectionId: connection.id,
          invitationId: connection.outOfBandId,
          state: 'terminated',
        })

        await sendWebhookEvent(config.webhookUrl + '/connection-state-updated', body, config.logger)
      }
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

      await sendWebhookEvent(config.webhookUrl + '/connection-state-updated', body, config.logger)
    },
  )

  // Auto-accept connections that go to the public did
  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async (data: DidCommConnectionStateChangedEvent) => {
      config.logger.debug(`Incoming connection event: ${data.payload.connectionRecord.state}}`)
      const oob = await agent.didcomm.oob.findById(data.payload.connectionRecord.outOfBandId!)
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
