import type { VsAgentNestPlugin } from './types'

import { setupChatProtocols } from '@verana-labs/vs-agent-sdk'

import {
  CoreMessageService,
  MessageController,
  MessageService,
  MessageServiceFactory,
  RedisMessageService,
} from '../controllers'
import { chatEvents } from '../events/MessageEvents'
import { HandledRedisModule } from '../modules/redis.module'

export const MessagingPlugin: VsAgentNestPlugin = {
  name: 'messaging',
  credoPlugin: setupChatProtocols(),
  controllers: [MessageController],
  providers: [MessageService, RedisMessageService, CoreMessageService, MessageServiceFactory],
  imports: [HandledRedisModule.forRoot()],
  registerEvents: (agent, config) => {
    chatEvents(agent as any, config)
  },
}
