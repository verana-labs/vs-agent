import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { BaseRecord } from '@credo-ts/core'
import {
  DidCommConnectionRecord,
  DidCommMessage,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
} from '@credo-ts/didcomm'
import { HttpStatus } from '@nestjs/common'

import { AdminApiError, AdminApiErrorCode, unknownConnection } from '../../../../common'

type Agent = VsAgent<BaseAgentModules>

export function moduleService<T>(agent: Agent, service: new (...args: any[]) => T, module: string): T {
  const { dependencyManager } = agent.context
  if (!dependencyManager.isRegistered(service)) {
    throw new AdminApiError(
      AdminApiErrorCode.UnknownId,
      HttpStatus.NOT_FOUND,
      `this deployment does not serve the ${module} module`,
    )
  }
  return dependencyManager.resolve(service)
}

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
