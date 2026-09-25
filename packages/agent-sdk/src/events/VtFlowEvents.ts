import type { VsAgent } from '../agent/VsAgent'

import { BaseLogger } from '@credo-ts/core'
import {
  VtFlowEventTypes,
  VtFlowRole,
  VtFlowService,
  type VtFlowStateChangedEvent,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VtFlowStateUpdated } from '@verana-labs/vs-agent-model'

import { emitVsAgentEvent, VsAgentEventTypes } from './VsAgentEvents'

export const vtFlowEvents = (agent: VsAgent, logger: BaseLogger) => {
  agent.events.on(VtFlowEventTypes.VtFlowStateChanged, async ({ payload }: VtFlowStateChangedEvent) => {
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

    try {
      await recordApplicantEntry(agent, payload.vtFlowRecordId)
    } catch (error) {
      logger.warn(
        `[vt-flow] cannot record the applicant entry of flow ${payload.vtFlowRecordId}: ${(error as Error).message}`,
      )
    }
  })
}

async function recordApplicantEntry(agent: VsAgent, vtFlowRecordId: string): Promise<void> {
  const agentContext = agent.context
  const service = agentContext.dependencyManager.resolve(VtFlowService)
  const record = await service.findById(agentContext, vtFlowRecordId)
  if (
    record?.role !== VtFlowRole.Validator ||
    record.variant !== VtFlowVariant.OnboardingProcess ||
    record.validatorParticipantId ||
    !record.applicantParticipantId
  ) {
    return
  }

  const applicant = await agent.indexer.findParticipant(record.applicantParticipantId)
  if (!applicant) return

  // re-read after the indexer call so the write keeps a transition made meanwhile
  const latest = await service.getById(agentContext, vtFlowRecordId)
  latest.validatorParticipantId = String(applicant.validatorParticipantId)
  latest.applicantParticipantRole = Number(applicant.role)
  latest.schemaId = String(applicant.schemaId)
  await service.updateRecord(agentContext, latest)
}
