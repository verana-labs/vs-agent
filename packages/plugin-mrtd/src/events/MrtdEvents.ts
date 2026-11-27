import {
  EMrtdDataReceivedEvent,
  MrtdEventTypes,
  MrtdProblemReportEvent,
  MrzDataReceivedEvent,
} from '@credo-ts/didcomm-mrtd'
import { BaseLogger } from '@credo-ts/core'
import { emitModuleMessageEvent, VsAgent } from '@verana-labs/vs-agent-sdk'

export const mrtdEvents = (agent: VsAgent<any>, logger: BaseLogger) => {
  agent.events.on(MrtdEventTypes.MrzDataReceived, ({ payload }: MrzDataReceivedEvent) => {
    logger.debug(`DidCommMessageProcessedEvent received: ${JSON.stringify(payload)}`)
    const { connection, mrzData, threadId } = payload

    emitModuleMessageEvent(agent, 'didcomm.mrtd.mrz-data-received', {
      connectionId: connection.id,
      threadId,
      mrzData,
    })
  })

  agent.events.on(MrtdEventTypes.EMrtdDataReceived, ({ payload }: EMrtdDataReceivedEvent) => {
    const { connection, dataGroups, threadId } = payload

    emitModuleMessageEvent(agent, 'didcomm.mrtd.emrtd-data-received', {
      connectionId: connection.id,
      threadId,
      dataGroups,
    })
  })

  // MRTD problem reports
  agent.events.on(MrtdEventTypes.MrtdProblemReport, ({ payload }: MrtdProblemReportEvent) => {
    const { connection, description, threadId } = payload

    emitModuleMessageEvent(agent, 'didcomm.mrtd.problem-report-received', {
      connectionId: connection.id,
      threadId,
      reason: description.code,
    })
  })
}
