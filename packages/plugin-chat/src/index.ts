export { setupChatProtocols } from './sdk/setupChatProtocols'
export type { ChatSdkPlugin } from './sdk/setupChatProtocols'

export { ChatMessageHandler } from './handlers/ChatMessageHandler'

export { chatEvents } from './events/ChatEvents'

export type { ChatAgentModules } from './types'

export { ChatPlugin } from './nestjs/ChatPlugin'
export type { ChatPluginOptions } from './nestjs/ChatPlugin'
export { DEFAULT_PROFILE } from './nestjs/defaultProfile'
export type { DefaultProfile } from './nestjs/defaultProfile'

export { V2DidcommActionMenuController } from './nestjs/V2DidcommActionMenuController'
export { V2DidcommCallsController } from './nestjs/V2DidcommCallsController'
export { V2DidcommMediaSharingController } from './nestjs/V2DidcommMediaSharingController'
export { V2DidcommQuestionAnswerController } from './nestjs/V2DidcommQuestionAnswerController'
export { V2DidcommReactionsController } from './nestjs/V2DidcommReactionsController'
export { V2DidcommReceiptsController } from './nestjs/V2DidcommReceiptsController'
export { V2DidcommUserProfileController } from './nestjs/V2DidcommUserProfileController'

export { registerDidcommModuleEvents } from './events/didcommModuleEvents'
