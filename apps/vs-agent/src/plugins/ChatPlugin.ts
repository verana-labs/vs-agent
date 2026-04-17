import type { VsAgentNestPlugin } from '../utils'

import { setupChatProtocols } from '@verana-labs/vs-agent-sdk'

import { ChatMessageHandler } from '../controllers/admin/message/handlers'
import { chatEvents } from '../events/ChatEvents'

export const ChatPlugin: VsAgentNestPlugin = {
  name: 'chat',
  credoPlugin: setupChatProtocols(),
  providers: [ChatMessageHandler],
  messageHandlers: [ChatMessageHandler],
  registerEvents: (agent, config) => {
    chatEvents(agent as any, config)
  },
}
