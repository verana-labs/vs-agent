import type { VsAgentNestPlugin } from '../utils'

import { setupMrtdProtocol } from '@verana-labs/vs-agent-sdk'

import { MrtdMessageHandler } from '../controllers'
import { mrtdEvents } from '../events/MrtdEvents'

export interface MrtdPluginOptions {
  masterListCscaLocation?: string
}

export const MrtdPlugin = (options?: MrtdPluginOptions): VsAgentNestPlugin => ({
  name: 'mrtd',
  credoPlugin: setupMrtdProtocol(options),
  providers: [MrtdMessageHandler],
  messageHandlers: [MrtdMessageHandler],
  registerEvents: (agent, config) => {
    mrtdEvents(agent, config)
  },
})
