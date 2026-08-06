// src/services/MessageService.ts

import { BaseMessage } from '@verana-labs/vs-agent-model'
import { Logger } from 'tslog'

import { ApiVersion } from '../types/enums'

const logger = new Logger({
  name: 'MessageService',
  type: 'pretty',
  prettyLogTemplate: '{{logLevelName}} [{{name}}]: ',
})

/**
 * `MessageService` class for handling message-related endpoints in the Agent Service.
 * This class is based on the `BaseMessage` from the `@verana-labs/vs-agent-model` library.
 *
 * The methods in this class allow for sending messages and managing related tasks.
 * For more details on the `BaseMessage` structure and usage, refer to the `@verana-labs/vs-agent-model` library.
 */
export class MessageService {
  private url: string

  constructor(
    private baseURL: string,
    private version: ApiVersion,
  ) {
    this.url = `${this.baseURL}/${this.version}/message`
  }

  public async send(message: BaseMessage): Promise<{ id: string }> {
    try {
      // Log the message content before sending
      logger.info(`submitMessage: ${JSON.stringify(message)}`)

      // Send the message via POST request
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })

      // Log the full response text
      const responseText = await response.text()
      logger.info(`response: ${responseText}`)

      let jsonResponse
      try {
        jsonResponse = JSON.parse(responseText)
      } catch (e) {
        throw new Error('Invalid JSON response')
      }

      if (!jsonResponse || typeof jsonResponse.id !== 'string') {
        throw new Error('Invalid response structure: Missing or invalid "id"')
      }

      // Parse and return the JSON response as expected
      return jsonResponse as { id: string }
    } catch (error) {
      logger.error(`Failed to send message: ${error}`)
      throw new Error('Failed to send message')
    }
  }
}
