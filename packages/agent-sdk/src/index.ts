// Agent
export * from './agent'
export * from './auth'
export * from './bootstrap'
export * from './types'

// Events
export * from './events'

// Plugins
export { setupBaseDidComm } from './plugins/setupBaseDidComm'
export type { BaseDidCommPlugin, BaseDidCommPluginOptions } from './plugins/setupBaseDidComm'

// DID utilities
export { CachedWebDidResolver } from './did/CachedWebDidResolver'
export { SafeWebVhDidResolver } from './did/SafeWebVhDidResolver'
export { WebDidRegistrar } from './did/WebDidRegistrar'
export { getLegacyDidDocument } from './did/legacyDidWeb'
export { applyAdminApiServiceEntry } from './did/adminApiService'

// Transports
export { HttpInboundTransport, HttpTransportSession } from './transports/HttpInboundTransport'
export { VsAgentWsInboundTransport, WebSocketTransportSession } from './transports/VsAgentWsInboundTransport'
export { VsAgentWsOutboundTransport } from './transports/VsAgentWsOutboundTransport'

// Credentials
export {
  FullTailsFileService,
  getTailsDirectoryPath,
  deleteTailsFile,
  isValidTailsFileName,
  migrateLegacyTailsFiles,
} from './credentials/FullTailsFileService'

// Utils
export * from './utils'

export * from './blockchain'
export * from './vtFlow'
