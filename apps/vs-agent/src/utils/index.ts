// Re-export from SDK for backwards compatibility
export {
  CachedWebDidResolver,
  HttpInboundTransport,
  HttpTransportSession,
  VsAgent,
  VsAgentWsInboundTransport,
  WebSocketTransportSession,
  VsAgentWsOutboundTransport,
  WebDidRegistrar,
  getLegacyDidDocument,
  getEcsSchemas,
  parseDataUrl,
  parsePictureData,
  createDataUrl,
  didcommReceiptFromVsAgentReceipt,
  UriValidator,
  FullTailsFileService,
  tailsIndex,
  baseFilePath,
  webhookListener,
  defaultDocumentLoader,
} from '@verana-labs/vs-agent-sdk'
export type {
  WebhookData,
  VsAgentOptions,
  BaseAgentModules,
  DidCommAgentModules,
} from '@verana-labs/vs-agent-sdk'

export * from './agent'
export * from './ServerConfig'
export * from './logger'
export * from './setupAgent'
export * from './setupSelfTr'
export * from './util'
