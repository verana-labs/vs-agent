import type { BaseAgentModules, VsAgent } from '../agent/VsAgent'

import { BaseRecord } from '@credo-ts/core'
import {
  DidCommConnectionRecord,
  DidCommMessage,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
} from '@credo-ts/didcomm'

import { unknownConnection } from './AdminApiError'

type Agent = VsAgent<BaseAgentModules>

export async function connectionOf(agent: Agent, connectionId: string): Promise<DidCommConnectionRecord> {
  const connection = await agent.didcomm.connections.findById(connectionId)
  if (!connection) throw unknownConnection(connectionId)
  return connection
}

export async function sendMessage(
  agent: Agent,
  connection: DidCommConnectionRecord,
  message: DidCommMessage,
  associatedRecord?: BaseRecord<any, any, any>,
): Promise<string> {
  await agent.context.dependencyManager.resolve(DidCommMessageSender).sendMessage(
    new DidCommOutboundMessageContext(message, {
      agentContext: agent.context,
      connection,
      associatedRecord,
    }),
  )
  return message.id
}
