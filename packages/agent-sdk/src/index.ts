// Agent
export * from './agent'
export * from './types'

// Plugins
export { setupBaseDidComm } from './plugins/setupBaseDidComm'
export type { BaseDidCommPlugin, BaseDidCommPluginOptions } from './plugins/setupBaseDidComm'

// DID utilities
export { CachedWebDidResolver } from './did/CachedWebDidResolver'
export { WebDidRegistrar } from './did/WebDidRegistrar'
export { getLegacyDidDocument } from './did/legacyDidWeb'

// Transports
export { HttpInboundTransport, HttpTransportSession } from './transports/HttpInboundTransport'
export { VsAgentWsInboundTransport, WebSocketTransportSession } from './transports/VsAgentWsInboundTransport'
export { VsAgentWsOutboundTransport } from './transports/VsAgentWsOutboundTransport'

// Credentials
export {
  FullTailsFileService,
  tailsIndex,
  baseFilePath,
  deleteTailsEntry,
} from './credentials/FullTailsFileService'

export * from './utils'

export * from './blockchain'
export * from './vtFlow'
