import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { mrtdEvents } from '../events/MrtdEvents'
import { MrtdMessageHandler } from '../handlers/MrtdMessageHandler'
import { setupMrtdProtocol, MrtdPluginOptions } from '../sdk/setupMrtdProtocol'

export const MrtdPlugin = (options?: MrtdPluginOptions): VsAgentNestPlugin => ({
  name: 'mrtd',
  credoPlugin: setupMrtdProtocol(options),
  providers: [MrtdMessageHandler],
  messageHandlers: [MrtdMessageHandler],
  registerEvents: (agent, config) => {
    mrtdEvents(agent, config)
  },
})
