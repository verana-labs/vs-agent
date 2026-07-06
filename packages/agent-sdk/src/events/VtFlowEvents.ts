import type { VsAgent } from '../agent/VsAgent'

import { BaseLogger } from '@credo-ts/core'
import { VtFlowEventTypes, type VtFlowStateChangedEvent } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VtFlowStateUpdated } from '@verana-labs/vs-agent-model'

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
        participantSessionId: payload.participantSessionId,
        connectionId: record.connectionId,
        role: record.role,
        variant: record.variant,
        state: payload.state,
        previousState: payload.previousState,
        participantId: record.participantId,
        schemaId: record.schemaId,
        claims: record.claims,
        credentialExchangeRecordId: record.credentialExchangeRecordId,
        errorMessage: record.errorMessage,
        subprotocolThid: record.subprotocolThid,
        agentParticipantId: record.agentParticipantId,
        walletAgentParticipantId: record.walletAgentParticipantId,
        timestamp: record.updatedAt,
      }),
    )
  })
}
