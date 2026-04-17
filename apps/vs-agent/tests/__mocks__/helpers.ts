import type { DidCommAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { DidCommConnectionProfileUpdatedEvent } from '@2060.io/credo-ts-didcomm-user-profile'
import { LogLevel } from '@credo-ts/core'
import {
  DidCommBasicMessage,
  DidCommCredentialExchangeRecord,
  DidCommCredentialStateChangedEvent,
  DidCommHandshakeProtocol,
  DidCommMessageProcessedEvent,
} from '@credo-ts/didcomm'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { vi } from 'vitest'

import { VsAgentModule } from '../../src/admin.module'
import { baseMessageEvents } from '../../src/events/BaseMessageEvents'
import { chatEvents } from '../../src/events/ChatEvents'
import { ChatPlugin } from '../../src/plugins/ChatPlugin'
import { MessagingPlugin } from '../../src/plugins/MessagingPlugin'
import { PublicModule } from '../../src/public.module'
import { ServerConfig, TsLogger } from '../../src/utils'

export async function makeConnection(
  agentA: VsAgent<DidCommAgentModules>,
  agentB: VsAgent<DidCommAgentModules>,
) {
  const agentAOutOfBand = await agentA.didcomm.oob.createInvitation({
    handshakeProtocols: [DidCommHandshakeProtocol.Connections],
  })

  let { connectionRecord: agentBConnection } = await agentB.didcomm.oob.receiveInvitation(
    agentAOutOfBand.outOfBandInvitation,
    { label: agentB.label },
  )

  agentBConnection = await agentB.didcomm.connections.returnWhenIsConnected(agentBConnection!.id)
  let [agentAConnection] = await agentA.didcomm.connections.findAllByOutOfBandId(agentAOutOfBand.id)
  agentAConnection = await agentA.didcomm.connections.returnWhenIsConnected(agentAConnection!.id)

  return [agentAConnection, agentBConnection]
}

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

export function waitForEvent<T>(
  eventEmitter: ReturnType<typeof vi.spyOn>,
  predicate: (event: unknown) => event is T,
): Promise<T> {
  const calls = eventEmitter.mock.calls as unknown[][]
  const existingEvent = calls.flat().find(predicate)
  if (existingEvent) {
    return Promise.resolve(existingEvent)
  }

  return new Promise(resolve => {
    const check = () => {
      const calls = eventEmitter.mock.calls as unknown[][]
      const events = calls.flat()
      const matchedEvent = events.find(predicate)
      if (matchedEvent) {
        resolve(matchedEvent)
      } else {
        setImmediate(check)
      }
    }
    check()
  })
}

export const startServersTesting = async (agent: VsAgent<DidCommAgentModules>): Promise<INestApplication> => {
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
