// Agent
export { VsAgent } from './agent/VsAgent'
export { type VsAgentOptions, BaseAgentModules } from './agent/VsAgent'
export type { BaseAgentModules as DidCommAgentModules } from './agent/VsAgent'
export { createVsAgent } from './agent/createVsAgent'
export type { CreateVsAgentOptions } from './agent/createVsAgent'
export type { Plugin } from './types'

// Plugins
export { setupBaseDidComm } from './plugins/setupBaseDidComm'
export type { BaseDidCommPlugin, BaseDidCommPluginOptions } from './plugins/setupBaseDidComm'

// NestJS integration
export type { VsAgentNestPlugin, VsAgentPluginConfig, MessageHandler } from './types'
export { MESSAGE_HANDLERS } from './types'

// DID utilities
export { CachedWebDidResolver } from './did/CachedWebDidResolver'
export { WebDidRegistrar } from './did/WebDidRegistrar'
export { getLegacyDidDocument } from './did/legacyDidWeb'

// Transports
export { HttpInboundTransport, HttpTransportSession } from './transports/HttpInboundTransport'
export { VsAgentWsInboundTransport, WebSocketTransportSession } from './transports/VsAgentWsInboundTransport'
export { VsAgentWsOutboundTransport } from './transports/VsAgentWsOutboundTransport'

// Credentials
export { FullTailsFileService, tailsIndex, baseFilePath } from './credentials/FullTailsFileService'

// Utils
export { createInvitation, getWebDid, getRecordId } from './utils/agent'
export { getEcsSchemas } from './utils/data'
export { webhookListener } from './utils/webhook'
export type { WebhookData } from './utils/webhook'
export { sendWebhookEvent, sendMessageReceivedEvent } from './utils/webhookEvent'
export * from './utils/util'
