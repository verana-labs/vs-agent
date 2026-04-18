import type { VsAgentPluginConfig } from '@verana-labs/vs-agent-sdk'

import {
  EMrtdDataReceivedEvent,
  MrtdEventTypes,
  MrtdProblemReportEvent,
  MrtdProblemReportReason,
  MrzDataReceivedEvent,
} from '@2060.io/credo-ts-didcomm-mrtd'
import { BaseMessage, MessageReceived } from '@verana-labs/vs-agent-model'
import { sendWebhookEvent, VsAgent } from '@verana-labs/vs-agent-sdk'

import { EMrtdDataSubmitMessage } from '../model/EMrtdDataSubmitMessage'
import { MrtdSubmitState } from '../model/MrtdSubmitState'
import { MrzDataSubmitMessage } from '../model/MrzDataSubmitMessage'

const getRecordId = async (agent: VsAgent<any>, id: string): Promise<string> => {
  const record = await agent.genericRecords.findById(id)
  return (record?.getTag('messageId') as string) ?? id
}

const sendMrtdEvent = async (
  agent: VsAgent<any>,
  message: BaseMessage,
  timestamp: Date,
  config: VsAgentPluginConfig,
) => {
  await sendWebhookEvent(
    config.webhookUrl + '/message-received',
    new MessageReceived({ timestamp, message }),
    config.logger,
  )
}

export const mrtdEvents = (agent: VsAgent<any>, config: VsAgentPluginConfig) => {
  agent.events.on(MrtdEventTypes.MrzDataReceived, async ({ payload }: MrzDataReceivedEvent) => {
    const { connection, mrzData, threadId } = payload

    const msg = new MrzDataSubmitMessage({
      connectionId: connection.id,
      threadId,
      state: MrtdSubmitState.Submitted,
      mrzData,
    })

    msg.id = await getRecordId(agent, msg.id)
    await sendMrtdEvent(agent, msg, msg.timestamp, config)
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
    await sendMrtdEvent(agent, msg, msg.timestamp, config)
  })

  // MRTD problem reports
  agent.events.on(MrtdEventTypes.MrtdProblemReport, async ({ payload }: MrtdProblemReportEvent) => {
    const { connection, description, threadId } = payload

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
      await sendMrtdEvent(agent, msg, msg.timestamp, config)
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
      await sendMrtdEvent(agent, msg, msg.timestamp, config)
    }
  })
}
