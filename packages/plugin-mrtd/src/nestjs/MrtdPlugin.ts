import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { mrtdEvents } from '../events/MrtdEvents'
import { setupMrtdProtocol, MrtdPluginOptions } from '../sdk/setupMrtdProtocol'

import { V2DidcommMrtdController } from './V2DidcommMrtdController'

export const MrtdPlugin = (options?: MrtdPluginOptions): VsAgentNestPlugin => ({
  name: 'mrtd',
  credoPlugin: setupMrtdProtocol(options),
  controllers: [V2DidcommMrtdController],
  didcommModules: [{ module: 'mrtd', prefixes: ['https://didcomm.org/mrtd/'] }],
  registerEvents: (agent, config) => {
    mrtdEvents(agent, config)
  },
})
