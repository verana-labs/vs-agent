import {
  EMrtdDataReceivedEvent,
  MrtdEventTypes,
  MrtdProblemReportEvent,
  MrtdProblemReportReason,
  MrzDataReceivedEvent,
} from '@2060.io/credo-ts-didcomm-mrtd'
import { BaseLogger } from '@credo-ts/core'
import {
  emitModuleMessageEvent,
  emitVsAgentEvent,
  msgToEvent,
  VsAgent,
  VsAgentEventTypes,
} from '@verana-labs/vs-agent-sdk'

import { EMrtdDataSubmitMessage } from '../model/EMrtdDataSubmitMessage'
import { MrtdSubmitState } from '../model/MrtdSubmitState'
import { MrzDataSubmitMessage } from '../model/MrzDataSubmitMessage'

const getRecordId = async (agent: VsAgent<any>, id: string): Promise<string> => {
  const record = await agent.genericRecords.findById(id)
  return (record?.getTag('messageId') as string) ?? id
}

export const mrtdEvents = (agent: VsAgent<any>, logger: BaseLogger) => {
  agent.events.on(MrtdEventTypes.MrzDataReceived, async ({ payload }: MrzDataReceivedEvent) => {
    logger.debug(`DidCommMessageProcessedEvent received: ${JSON.stringify(payload)}`)
    const { connection, mrzData, threadId } = payload

    const msg = new MrzDataSubmitMessage({
      connectionId: connection.id,
      threadId,
      state: MrtdSubmitState.Submitted,
      mrzData,
    })

    msg.id = await getRecordId(agent, msg.id)
    emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(msg))
    emitModuleMessageEvent(agent, 'didcomm.mrtd.mrz-data-received', {
      connectionId: connection.id,
      threadId,
      mrzData,
    })
  })

  agent.events.on(MrtdEventTypes.EMrtdDataReceived, async ({ payload }: EMrtdDataReceivedEvent) => {
    const { connection, dataGroups, threadId } = payload

    const msg = new EMrtdDataSubmitMessage({
      connectionId: connection.id,
      threadId,
      state: MrtdSubmitState.Submitted,
      dataGroups,
    })

    msg.id = await getRecordId(agent, msg.id)
    emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(msg))
    emitModuleMessageEvent(agent, 'didcomm.mrtd.emrtd-data-received', {
      connectionId: connection.id,
      threadId,
      dataGroups,
    })
  })

  // MRTD problem reports
  agent.events.on(MrtdEventTypes.MrtdProblemReport, async ({ payload }: MrtdProblemReportEvent) => {
    const { connection, description, threadId } = payload

    emitModuleMessageEvent(agent, 'didcomm.mrtd.problem-report-received', {
      connectionId: connection.id,
      threadId,
      reason: description.code,
    })

    const stateMap: Record<MrtdProblemReportReason, MrtdSubmitState> = {
      'e.p.emrtd-refused': MrtdSubmitState.Declined,
      'e.p.emrtd-timeout': MrtdSubmitState.Timeout,
      'e.p.mrz-refused': MrtdSubmitState.Declined,
      'e.p.mrz-timeout': MrtdSubmitState.Timeout,
    }

    if (
      [MrtdProblemReportReason.EmrtdRefused, MrtdProblemReportReason.EmrtdTimeout].includes(
        description.code as MrtdProblemReportReason,
      )
    ) {
      const msg = new EMrtdDataSubmitMessage({
        connectionId: connection.id,
        threadId,
        state: stateMap[description.code as MrtdProblemReportReason],
      })
      msg.id = await getRecordId(agent, msg.id)
      emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(msg))
    } else if (
      [MrtdProblemReportReason.MrzRefused, MrtdProblemReportReason.MrzTimeout].includes(
        description.code as MrtdProblemReportReason,
      )
    ) {
      const msg = new MrzDataSubmitMessage({
        connectionId: connection.id,
        threadId,
        state: stateMap[description.code as MrtdProblemReportReason],
      })
      msg.id = await getRecordId(agent, msg.id)
      emitVsAgentEvent(agent, VsAgentEventTypes.MessageReceived, msgToEvent(msg))
    }
  })
}
