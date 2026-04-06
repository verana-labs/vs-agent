import type { VsAgentNestPlugin } from './types'

import { setupChatProtocols } from '@verana-labs/vs-agent-sdk'

import {
  ConnectionController,
  CoreMessageService,
  MessageController,
  MessageService,
  MessageServiceFactory,
  PresentationsController,
  RedisMessageService,
} from '../controllers'
import { connectionEvents } from '../events/ConnectionEvents'
import { chatEvents } from '../events/MessageEvents'
import { HandledRedisModule } from '../modules/redis.module'

export const ChatPlugin: VsAgentNestPlugin = {
  name: 'chat',
  credoPlugin: setupChatProtocols(),
  controllers: [ConnectionController, MessageController, PresentationsController],
  providers: [MessageService, RedisMessageService, CoreMessageService, MessageServiceFactory],
  imports: [HandledRedisModule.forRoot()],
  registerEvents: (agent, config) => {
    connectionEvents(agent as any, config)
    chatEvents(agent as any, config)
  },
}
