import type { BaseLogger } from '@credo-ts/core'

import { BaseMessage, Event, MessageReceived } from '@verana-labs/vs-agent-model'

import { VsAgentPluginConfig } from '../types'

export const sendWebhookEvent = async (webhookUrl: string, body: Event, logger: BaseLogger) => {
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

export const sendMessageReceivedEvent = async (
  message: BaseMessage,
  timestamp: Date,
  config: VsAgentPluginConfig,
) => {
  const body = new MessageReceived({ timestamp, message })
  await sendWebhookEvent(config.webhookUrl + '/message-received', body, config.logger)
}
