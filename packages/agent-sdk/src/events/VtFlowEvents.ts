import type { ServerConfig } from '../utils'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { VtFlowEventTypes, type VtFlowStateChangedEvent } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { EventType, VtFlowStateUpdated } from '@verana-labs/vs-agent-model'
import { sendWebhookEvent } from '@verana-labs/vs-agent-sdk'

export const vtFlowEvents = async (agent: VsAgent, config: ServerConfig) => {
  agent.events.on(VtFlowEventTypes.VtFlowStateChanged, async ({ payload }: VtFlowStateChangedEvent) => {
    const record = await agent.modules.vtFlow.findById(payload.vtFlowRecordId)
    if (!record) return

    const body = new VtFlowStateUpdated({
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
    })

    await sendWebhookEvent(config.webhookUrl + '/' + EventType.VtFlowStateUpdated, body, config.logger)
  })
}
