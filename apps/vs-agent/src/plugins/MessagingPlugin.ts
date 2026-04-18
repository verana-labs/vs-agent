import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  CoreMessageService,
  MessageController,
  MessageService,
  MessageServiceFactory,
  RedisMessageService,
  BaseMessageHandler,
} from '../controllers'
import { baseMessageEvents } from '../events/BaseMessageEvents'
import { HandledRedisModule } from '../modules/redis.module'

export const MessagingPlugin: VsAgentNestPlugin = {
  name: 'messaging',
  controllers: [MessageController],
  providers: [
    MessageService,
    RedisMessageService,
    CoreMessageService,
    MessageServiceFactory,
    BaseMessageHandler,
  ],
  messageHandlers: [BaseMessageHandler],
  imports: [HandledRedisModule.forRoot()],
  registerEvents: (agent, config) => {
    baseMessageEvents(agent as any, config)
  },
}
