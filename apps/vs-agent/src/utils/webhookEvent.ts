import type { BaseLogger } from '@credo-ts/core'
import type { Event } from '@verana-labs/vs-agent-model'

import {
  VsAgent,
  VsAgentConnectionStateEvent,
  VsAgentEventTypes,
  VsAgentMessageReceivedEvent,
  VsAgentMessageStateUpdatedEvent,
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
}
