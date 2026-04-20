import type { DidCommConnectionRecord } from '@credo-ts/didcomm'
import type { IBaseMessage, MessageType } from '@verana-labs/vs-agent-model'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

export interface MessageHandler {
  readonly supportedTypes: MessageType[]
  readonly openApiExamples: Record<string, { summary: string; description: string; value: object }>

  handle(
    agent: VsAgent<any>,
    message: IBaseMessage,
    connection: DidCommConnectionRecord,
  ): Promise<string | undefined>
}

export const MESSAGE_HANDLERS = 'MESSAGE_HANDLERS'
