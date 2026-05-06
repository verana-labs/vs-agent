import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { DidCommConnectionProfileUpdatedEvent } from '@2060.io/credo-ts-didcomm-user-profile'
import { LogLevel } from '@credo-ts/core'
import {
  DidCommBasicMessage,
  DidCommCredentialExchangeRecord,
  DidCommCredentialStateChangedEvent,
  DidCommMessageProcessedEvent,
} from '@credo-ts/didcomm'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { chatEvents, ChatPlugin } from '@verana-labs/vs-agent-plugin-chat'

import { VsAgentModule } from '../../src/admin.module'
import { baseMessageEvents } from '../../src/events/BaseMessageEvents'
import { MessagingPlugin } from '../../src/plugins/MessagingPlugin'
import { PublicModule } from '../../src/public.module'
import { ServerConfig, TsLogger } from '../../src/utils'

export function isCredentialStateChangedEvent(arg: unknown): arg is DidCommCredentialStateChangedEvent {
  const { type, payload } = arg as any
  return (
    typeof arg === 'object' &&
    arg !== null &&
    type === 'DidCommCredentialStateChanged' &&
    !!payload?.credentialExchangeRecord &&
    payload?.credentialExchangeRecord.type === DidCommCredentialExchangeRecord.type
  )
}

export function isAgentMessageProcessedEvent(arg: unknown): arg is DidCommMessageProcessedEvent {
  const { type, payload } = arg as any
  return (
    typeof arg === 'object' &&
    arg !== null &&
    type === 'DidCommMessageProcessed' &&
    !!payload?.message &&
    payload?.message.type === DidCommBasicMessage.type.messageTypeUri &&
    !!payload?.connection
  )
}

export function isConnectionProfileUpdatedEvent(arg: unknown): arg is DidCommConnectionProfileUpdatedEvent {
  const { type, payload } = arg as any
  return (
    typeof arg === 'object' &&
    arg !== null &&
    type === 'DidCommConnectionProfileUpdated' &&
    !!payload?.profile &&
    !!payload?.connection
  )
}

export const startServersTesting = async (agent: VsAgent<BaseAgentModules>): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      VsAgentModule.register(agent, 'http://localhost:3001', [MessagingPlugin, ChatPlugin]),
      PublicModule.register(agent, 'http://localhost:3001'),
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()

  const conf: ServerConfig = {
    port: 3000,
    logger: new TsLogger(LogLevel.Off, agent.label),
    publicApiBaseUrl: 'http://localhost:3001',
    webhookUrl: 'http://localhost:5000',
    endpoints: agent.didcomm.config.endpoints,
  }
  baseMessageEvents(agent, conf)
  chatEvents(agent as any, conf)
  return app
}
