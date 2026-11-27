import type { ChatAgentModules } from '../types'

import { BaseLogger } from '@credo-ts/core'
import {
  DidCommConnectionEventTypes,
  DidCommConnectionStateChangedEvent,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

export const chatEvents = async (agent: VsAgent<ChatAgentModules>, logger: BaseLogger) => {
  agent.events.on(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    async ({ payload }: DidCommConnectionStateChangedEvent) => {
      if (payload.connectionRecord.state === DidCommDidExchangeState.Completed) {
        await agent.modules.userProfile.requestUserProfile({ connectionId: payload.connectionRecord.id })
      }
    },
  )
}
