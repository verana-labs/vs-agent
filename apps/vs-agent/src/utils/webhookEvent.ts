import type { BaseLogger } from '@credo-ts/core'
import type { Event } from '@verana-labs/vs-agent-model'

import {
  VsAgent,
  VsAgentConnectionStateEvent,
  VsAgentEventTypes,
  VsAgentIndexerNotificationEvent,
  VsAgentMessageReceivedEvent,
  VsAgentPresentationStateUpdatedEvent,
  VsAgentVtFlowStateUpdatedEvent,
} from '@verana-labs/vs-agent-sdk'

export interface WebhookOptions {
  url: string
  apiKey?: string
}

export const webhookEvent = (agent: VsAgent, options: WebhookOptions, logger: BaseLogger) => {
  const { url, apiKey } = options
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
  const sendWebhookEvent = async (body: Event) => {
    try {
      logger.debug(`sending webhook event to ${url}: ${JSON.stringify(body)}`)
      await fetch(url, { method: 'POST', body: JSON.stringify(body), headers })
    } catch (error) {
      logger.error(`Error sending ${body.type} webhook event to ${url}`, { cause: error })
    }
  }

  agent.events.on<VsAgentConnectionStateEvent>(VsAgentEventTypes.ConnectionStateUpdated, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentMessageReceivedEvent>(VsAgentEventTypes.MessageReceived, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentVtFlowStateUpdatedEvent>(VsAgentEventTypes.VtFlowStateUpdated, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentIndexerNotificationEvent>(VsAgentEventTypes.IndexerNotification, ({ payload }) =>
    sendWebhookEvent(payload.event),
  )
  agent.events.on<VsAgentPresentationStateUpdatedEvent>(
    VsAgentEventTypes.PresentationStateUpdated,
    async ({ payload }) => {
      const { callbackUrl, ref, claims, state, verified, proofExchangeId } = payload.event
      if (!callbackUrl) return

      const body = { ref, claims, state, verified, proofExchangeId }
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
