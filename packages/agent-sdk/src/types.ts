import type { IBaseMessage, MessageType } from '@verana-labs/vs-agent-model'

import { BaseLogger } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { BaseAgentModules, VsAgent } from './agent/VsAgent'

export const MESSAGE_HANDLERS = 'MESSAGE_HANDLERS'

export interface VsAgentPluginConfig {
  logger: BaseLogger
  webhookUrl?: string
}

export interface MessageHandler {
  readonly supportedTypes: MessageType[]
  readonly openApiExamples: Record<string, { summary: string; description: string; value: object }>
  handle(
    agent: VsAgent<any>,
    message: IBaseMessage,
    connection: DidCommConnectionRecord,
  ): Promise<string | undefined>
}

export type Plugin = { modules: Record<string, unknown> }

export interface VsAgentNestPlugin {
  name: string
  credoPlugin?: Plugin
  controllers?: (new (...args: any[]) => any)[]
  providers?: any[]
  messageHandlers?: (new (...args: any[]) => MessageHandler)[]
  imports?: any[]
  registerEvents?: (agent: VsAgent<BaseAgentModules>, config: VsAgentPluginConfig) => void
}
