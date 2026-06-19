import type { BaseAgentModules, VsAgent } from './agent/VsAgent'
import type { IBaseMessage, MessageType } from '@verana-labs/vs-agent-model'

import { BaseLogger } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { KdfMethod } from '@openwallet-foundation/askar-nodejs'

export const MESSAGE_HANDLERS = 'MESSAGE_HANDLERS'

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
  registerEvents?: (agent: VsAgent<BaseAgentModules>, logger: BaseLogger) => void
}

export const keyDerivationMethodMap: {
  [key: string]: `${KdfMethod.Argon2IInt}` | `${KdfMethod.Argon2IMod}` | `${KdfMethod.Raw}`
} = {
  ARGON2I_INT: KdfMethod.Argon2IInt,
  ARGON2I_MOD: KdfMethod.Argon2IMod,
  RAW: KdfMethod.Raw,
}

export const ISSUER_PARTICIPANT_TYPE = 1
