import { setupBaseDidComm } from './setupBaseDidComm'
import { setupChatProtocols } from './setupChatProtocols'
import { setupMrtdProtocol } from './setupMrtdProtocol'

export interface DidCommPluginOptions {
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
  return {
    modules: {
      ...setupBaseDidComm({ endpoints: options.endpoints }).modules,
      ...setupChatProtocols().modules,
      ...setupMrtdProtocol({ masterListCscaLocation: options.masterListCscaLocation }).modules,
    },
  }
}
