import { utils } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { IBaseMessage } from '@verana-labs/vs-agent-model'

import { VsAgentService } from '../../../services/VsAgentService'

import { MESSAGE_HANDLERS, MessageHandler } from './MessageHandler'

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name)
  private readonly handlerMap = new Map<string, MessageHandler>()

  constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject(MESSAGE_HANDLERS) handlersOrHandler: MessageHandler | MessageHandler[],
  ) {
    // NestJS multi-providers inject an array, but guard against a single value just in case
    const handlers = Array.isArray(handlersOrHandler) ? handlersOrHandler : [handlersOrHandler]
    for (const handler of handlers) {
      for (const type of handler.supportedTypes) {
        this.handlerMap.set(type, handler)
      }
    }
  }

  get supportedTypes(): string[] {
    return [...this.handlerMap.keys()]
  }

  get openApiExamples(): Record<string, { summary: string; description: string; value: object }> {
    const examples: Record<string, any> = {}
    for (const handler of new Set(this.handlerMap.values())) {
      Object.assign(examples, handler.openApiExamples)
    }
    return examples
  }

  public async sendMessage(
    message: IBaseMessage,
    connection: DidCommConnectionRecord,
  ): Promise<{ id: string }> {
    try {
      const agent = await this.agentService.getAgent()
      this.logger.debug!(`Message submitted. ${JSON.stringify(message)}`)

      const handler = this.handlerMap.get(message.type)
      if (!handler) {
        throw new Error(
          `Unsupported message type: ${message.type}. Enabled types: ${[...this.handlerMap.keys()].join(', ')}`,
        )
      }

      const messageId = await handler.handle(agent, message, connection)

      if (messageId) {
        try {
          await agent.genericRecords.save({
            id: messageId,
            content: {},
            tags: { messageId: message.id, connectionId: message.connectionId },
          })
          this.logger.debug!(`messageId saved: ${messageId}`)
        } catch (error) {
          this.logger.warn(`Cannot save message with ${messageId}: ${error.stack}`)
        }
      }

      return { id: messageId ?? utils.uuid() } // TODO: persistant mapping between AFJ records and Service Agent flows. Support external message id setting
    } catch (error) {
      this.logger.error(`Error: ${error.stack}`)
      throw new Error(`something went wrong: ${error}`)
    }
  }
}
