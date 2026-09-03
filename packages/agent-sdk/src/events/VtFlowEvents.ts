import type { VsAgent } from '../agent/VsAgent'

import { BaseLogger } from '@credo-ts/core'
import { VtFlowEventTypes, type VtFlowStateChangedEvent } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VtFlowStateUpdated } from '@verana-labs/vs-agent-model'

import { emitVsAgentEvent, VsAgentEventTypes } from './VsAgentEvents'

export const vtFlowEvents = (agent: VsAgent, logger: BaseLogger) => {
  agent.events.on(VtFlowEventTypes.VtFlowStateChanged, ({ payload }: VtFlowStateChangedEvent) => {
    logger.debug(`Incoming vtFlow state change: ${payload.vtFlowRecordId}`)
    emitVsAgentEvent(
      agent,
      VsAgentEventTypes.VtFlowStateUpdated,
      new VtFlowStateUpdated({
        vtFlowRecordId: payload.vtFlowRecordId,
        state: payload.state,
        previousState: payload.previousState,
      }),
    )
  })
}
