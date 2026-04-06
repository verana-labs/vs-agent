import { AskarModuleConfigStoreOptions } from '@credo-ts/askar'

import { setupBaseDidComm } from './setupBaseDidComm'
import { setupChatProtocols } from './setupChatProtocols'
import { setupMrtdProtocol } from './setupMrtdProtocol'

export interface DidCommPluginOptions {
  walletConfig: AskarModuleConfigStoreOptions
  publicApiBaseUrl: string
  endpoints: string[]
  masterListCscaLocation?: string
}

export interface DidCommPlugin {
  modules: ReturnType<typeof setupBaseDidComm>['modules'] &
    ReturnType<typeof setupChatProtocols>['modules'] &
    ReturnType<typeof setupMrtdProtocol>['modules']
}

/**
 * Convenience plugin: combines setupBaseDidComm + setupChatProtocols + setupMrtdProtocol.
 * For selective module inclusion, use the individual setup functions instead.
 */
export function setupDidComm(options: DidCommPluginOptions): DidCommPlugin {
  const { walletConfig, publicApiBaseUrl, endpoints, masterListCscaLocation } = options
  return {
    modules: {
      ...setupBaseDidComm({ walletConfig, publicApiBaseUrl, endpoints }).modules,
      ...setupChatProtocols().modules,
      ...setupMrtdProtocol({ masterListCscaLocation }).modules,
    },
  }
}
