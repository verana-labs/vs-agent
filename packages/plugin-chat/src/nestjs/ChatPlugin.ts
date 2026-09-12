import type { ChatAgentModules } from '../types'
import type { VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { chatEvents } from '../events/ChatEvents'
import { registerDidcommModuleEvents } from '../events/didcommModuleEvents'
import { ChatMessageHandler } from '../handlers/ChatMessageHandler'
import { setupChatProtocols } from '../sdk/setupChatProtocols'

import { DEFAULT_PROFILE, type DefaultProfile } from './defaultProfile'
import { V2DidcommActionMenuController } from './V2DidcommActionMenuController'
import { V2DidcommCallsController } from './V2DidcommCallsController'
import { V2DidcommMediaSharingController } from './V2DidcommMediaSharingController'
import { V2DidcommQuestionAnswerController } from './V2DidcommQuestionAnswerController'
import { V2DidcommReactionsController } from './V2DidcommReactionsController'
import { V2DidcommReceiptsController } from './V2DidcommReceiptsController'
import { V2DidcommUserProfileController } from './V2DidcommUserProfileController'

export interface ChatPluginOptions {
  defaultProfile?: DefaultProfile
}

export const ChatPlugin = (options?: ChatPluginOptions): VsAgentNestPlugin => ({
  name: 'chat',
  credoPlugin: setupChatProtocols(),
  controllers: [
    V2DidcommReceiptsController,
    V2DidcommReactionsController,
    V2DidcommUserProfileController,
    V2DidcommMediaSharingController,
    V2DidcommCallsController,
    V2DidcommActionMenuController,
    V2DidcommQuestionAnswerController,
  ],
  providers: [ChatMessageHandler, { provide: DEFAULT_PROFILE, useValue: options?.defaultProfile }],
  messageHandlers: [ChatMessageHandler],
  registerEvents: (agent, config) => {
    chatEvents(agent as VsAgent<ChatAgentModules>, config)
    registerDidcommModuleEvents(agent)
  },
})
