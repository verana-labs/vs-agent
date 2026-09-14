import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { mrtdEvents } from '../events/MrtdEvents'
import { MrtdMessageHandler } from '../handlers/MrtdMessageHandler'
import { setupMrtdProtocol, MrtdPluginOptions } from '../sdk/setupMrtdProtocol'

import { V2DidcommMrtdController } from './V2DidcommMrtdController'

export const MrtdPlugin = (options?: MrtdPluginOptions): VsAgentNestPlugin => ({
  name: 'mrtd',
  credoPlugin: setupMrtdProtocol(options),
  controllers: [V2DidcommMrtdController],
  providers: [MrtdMessageHandler],
  messageHandlers: [MrtdMessageHandler],
  registerEvents: (agent, config) => {
    mrtdEvents(agent, config)
  },
})
