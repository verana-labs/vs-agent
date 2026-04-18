import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { chatEvents } from '../events/ChatEvents'
import { ChatMessageHandler } from '../handlers/ChatMessageHandler'
import { setupChatProtocols } from '../sdk/setupChatProtocols'

export const ChatPlugin: VsAgentNestPlugin = {
  name: 'chat',
  credoPlugin: setupChatProtocols(),
  providers: [ChatMessageHandler],
  messageHandlers: [ChatMessageHandler],
  registerEvents: (agent, config) => {
    chatEvents(agent as any, config)
  },
}
