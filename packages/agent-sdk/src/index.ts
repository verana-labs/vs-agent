// Agent
export { VsAgent } from './agent/VsAgent'
export type { VsAgentOptions } from './agent/VsAgent'
export { createVsAgent } from './agent/createVsAgent'
export type { CreateVsAgentOptions, Plugin } from './agent/createVsAgent'
export type { BaseAgentModules, ChatAgentModules, MrtdAgentModules, DidCommAgentModules } from './agent/types'

// Plugins
export { setupBaseDidComm } from './plugins/setupBaseDidComm'
export type { BaseDidCommPlugin, BaseDidCommPluginOptions } from './plugins/setupBaseDidComm'
export { setupChatProtocols } from './plugins/setupChatProtocols'
export type { ChatPlugin } from './plugins/setupChatProtocols'
export { setupMrtdProtocol } from './plugins/setupMrtdProtocol'
export type { MrtdPlugin, MrtdPluginOptions } from './plugins/setupMrtdProtocol'
export { setupDidComm } from './plugins/setupDidComm'
export type { DidCommPlugin, DidCommPluginOptions } from './plugins/setupDidComm'

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
export { createInvitation, getWebDid } from './utils/agent'
export {
  parseDataUrl,
  parsePictureData,
  createDataUrl,
  didcommReceiptFromVsAgentReceipt,
  UriValidator,
} from './utils/parsers'
export { getEcsSchemas } from './utils/data'
export { webhookListener } from './utils/webhook'
export type { WebhookData } from './utils/webhook'
export * from './utils/util'
