import type { BaseLogger } from '@credo-ts/core'
import type { Event } from '@verana-labs/vs-agent-model'

export const webhookEvent = (webhookUrl: string, logger: BaseLogger) => async (body: Event) => {
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
