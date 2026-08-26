import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  CoreMessageService,
  V1MessageController,
  MessageService,
  MessageServiceFactory,
  RedisMessageService,
  BaseMessageHandler,
} from '../controllers'
import { HandledRedisModule } from '../modules/redis.module'

export const MessagingPlugin: VsAgentNestPlugin = {
  name: 'messaging',
  controllers: [V1MessageController],
  providers: [
    MessageService,
    RedisMessageService,
    CoreMessageService,
    MessageServiceFactory,
    BaseMessageHandler,
  ],
  messageHandlers: [BaseMessageHandler],
  imports: [HandledRedisModule.forRoot()],
}
