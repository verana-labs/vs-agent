import type { BaseLogger } from '@credo-ts/core'
import type { Event } from '@verana-labs/vs-agent-model'

import {
  VsAgent,
  VsAgentConnectionStateEvent,
  VsAgentEventTypes,
  VsAgentMessageReceivedEvent,
  VsAgentMessageStateUpdatedEvent,
  VsAgentPresentationStatusUpdatedEvent,
} from '@verana-labs/vs-agent-sdk'

export const webhookEvent = (agent: VsAgent, webhookUrl: string, logger: BaseLogger) => {
  const sendWebhookEvent = async (body: Event) => {
    try {
      logger.debug(`sending webhook event to ${webhookUrl}: ${JSON.stringify(body)}`)
      await fetch(webhookUrl, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      logger.error(`Error sending ${body.type} webhook event to ${webhookUrl}`, {
        cause: error,
      })
    }
  }

  agent.events.on<VsAgentConnectionStateEvent>(VsAgentEventTypes.ConnectionStateUpdated, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentMessageReceivedEvent>(VsAgentEventTypes.MessageReceived, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentMessageStateUpdatedEvent>(VsAgentEventTypes.MessageStateUpdated, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentPresentationStatusUpdatedEvent>(
    VsAgentEventTypes.PresentationStatusUpdated,
    async ({ payload }) => {
      const { callbackUrl, ref, claims, status, verified, proofExchangeId } = payload.event
      if (!callbackUrl) return

      const body = { ref, claims, status, verified, proofExchangeId }
      try {
        logger.debug(`sending presentation callback event to ${callbackUrl}: ${JSON.stringify(body)}`)
        await fetch(callbackUrl, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        logger.error(`sending presentation callback event to ${callbackUrl}`, { cause: error })
      }
    },
  )
}
