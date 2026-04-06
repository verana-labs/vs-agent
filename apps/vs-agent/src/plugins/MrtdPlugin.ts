import type { VsAgentNestPlugin } from './types'

import { setupMrtdProtocol } from '@verana-labs/vs-agent-sdk'

import { mrtdEvents } from '../events/MrtdEvents'

export interface MrtdPluginOptions {
  masterListCscaLocation?: string
}

export const MrtdPlugin = (options?: MrtdPluginOptions): VsAgentNestPlugin => ({
  name: 'mrtd',
  credoPlugin: setupMrtdProtocol(options),
  registerEvents: (agent, config) => {
    mrtdEvents(agent, config)
  },
})
