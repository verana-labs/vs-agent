import type { BaseLogger } from '@credo-ts/core'
import type { Event } from '@verana-labs/vs-agent-model'

import { VsAgent, VsAgentEventType, type VsAgentEvent } from '@verana-labs/vs-agent-sdk'

/**
 * Listens to VS Agent domain events from the agent bus and forwards each to the webhook
 * endpoint (`POST /${event.type}`).
 */
export const webhookEvent = (agent: VsAgent, webhookUrl: string, logger: BaseLogger) => {
  const post = async (body: Event) => {
    try {
      logger.debug(`sending webhook event to ${webhookUrl}: ${JSON.stringify(body)}`)
      await fetch(`${webhookUrl}/${body.type}`, {
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

  for (const type of Object.values(VsAgentEventType)) {
    agent.events.on(type, ({ payload }: VsAgentEvent) => post(payload.event as Event))
  }
}
