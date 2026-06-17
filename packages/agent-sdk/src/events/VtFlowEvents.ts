import { BaseLogger } from '@credo-ts/core'
import { VtFlowEventTypes, type VtFlowStateChangedEvent } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VtFlowStateUpdated } from '@verana-labs/vs-agent-model'

import { VsAgent } from '../agent'

import { emitVsAgentEvent, VsAgentEventTypes } from './VsAgentEvents'

export const vtFlowEvents = async (agent: VsAgent, logger: BaseLogger) => {
  agent.events.on(VtFlowEventTypes.VtFlowStateChanged, async ({ payload }: VtFlowStateChangedEvent) => {
    logger.debug(`Incoming vtFlow state change: ${payload.vtFlowRecordId}`)
    const record = await agent.modules.vtFlow.findById(payload.vtFlowRecordId)
    if (!record) return
    emitVsAgentEvent(
      agent,
      VsAgentEventTypes.VtFlowStateUpdated,
      new VtFlowStateUpdated({
        vtFlowRecordId: payload.vtFlowRecordId,
        threadId: payload.threadId,
        sessionUuid: payload.sessionUuid,
        connectionId: record.connectionId,
        role: record.role,
        variant: record.variant,
        state: payload.state,
        previousState: payload.previousState,
        permId: record.permId,
        schemaId: record.schemaId,
        claims: record.claims,
        credentialExchangeRecordId: record.credentialExchangeRecordId,
        errorMessage: record.errorMessage,
        subprotocolThid: record.subprotocolThid,
        agentPermId: record.agentPermId,
        walletAgentPermId: record.walletAgentPermId,
        timestamp: record.updatedAt,
      }),
    )
  })
}
