import { DidCommMrtdModule } from '@2060.io/credo-ts-didcomm-mrtd'

import { MrtdAgentModules } from '../agent/types'

export interface MrtdPluginOptions {
  masterListCscaLocation?: string
}

export interface MrtdPlugin {
  modules: Pick<MrtdAgentModules, 'mrtd'>
}

/**
 * Sets up the eMRTD (electronic passport / travel document) DIDComm protocol module.
 * This is kept as a separate plugin because it introduces native binary dependencies.
 * Must be used together with setupBaseDidComm().
 */
export function setupMrtdProtocol(options?: MrtdPluginOptions): MrtdPlugin {
  return {
    modules: {
      mrtd: new DidCommMrtdModule({ masterListCscaLocation: options?.masterListCscaLocation }),
    },
  }
}
