import type { BaseLogger } from '@credo-ts/core'
import type {
  DidCommBasicMessageRecord,
  DidCommBasicMessageStateChangedEvent,
  DidCommBasicMessageV2StateChangedEvent,
  DidCommConnectionStateChangedEvent,
  DidCommCredentialStateChangedEvent,
  DidCommProofStateChangedEvent,
} from '@credo-ts/didcomm'
import type { Event } from '@verana-labs/vs-agent-model'

import { utils } from '@credo-ts/core'
import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRole,
  DidCommConnectionEventTypes,
  DidCommCredentialEventTypes,
  DidCommProofEventTypes,
} from '@credo-ts/didcomm'
import { EventType } from '@verana-labs/vs-agent-model'
import {
  VsAgent,
  VsAgentEventTypes,
  VsAgentIndexerNotificationEvent,
  VsAgentVtFlowStateUpdatedEvent,
} from '@verana-labs/vs-agent-sdk'

import { resolveV2FlowRecord } from '../controllers/admin/vt-flow/VtFlowsService'

import {
  toConnectionDto,
  toCredentialExchangeDto,
  toPresentationDto,
} from '../controllers/admin/v2/didcomm/mappers'

export interface WebhookOptions {
  url: string
  apiKey?: string
}

const EXTENSION_MODULES: Record<string, string> = {
  'https://didcomm.org/reactions/1.0': 'reactions',
  'https://didcomm.org/user-profile/1.0': 'user-profile',
  'https://didcomm.org/media-sharing/1.0': 'media-sharing',
  'https://didcomm.org/calls/1.0': 'calls',
  'https://didcomm.org/action-menu/1.0': 'action-menu',
  'https://didcomm.org/questionanswer/1.0': 'question-answer',
  'https://didcomm.org/mrtd/1.0': 'mrtd',
}

const RECEIPTS_MESSAGE_TYPE = 'https://didcomm.org/receipts/1.0/message-receipts'

interface ReceiptsMessage {
  receipts: { messageId: string; state: string; timestamp?: Date }[]
}

export const webhookEvent = (agent: VsAgent, options: WebhookOptions, logger: BaseLogger) => {
  const { url, apiKey } = options
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }

  const deliver = (type: string, data: unknown): void => {
    const envelope = { id: utils.uuid(), type, timestamp: new Date().toISOString(), data }
    logger.debug(`delivering event ${type} ${envelope.id} to ${url}`)
    fetch(url, { method: 'POST', headers, body: JSON.stringify(envelope) })
      .then(response => {
        if (!response.ok)
          logger.error(`event ${type} ${envelope.id} delivery failed: HTTP ${response.status}`)
      })
      .catch(error => logger.error(`event ${type} ${envelope.id} delivery failed`, { cause: error }))
  }

  // a listener is never awaited, so a rejection here would take the process down
  const stateUpdated = async (
    type: EventType,
    record: object | Promise<object>,
    previousState: string | null,
  ): Promise<void> => {
    try {
      deliver(type, { ...(await record), previousState })
    } catch (error) {
      logger.error(`event ${type} delivery failed`, { cause: error })
    }
  }

  agent.events.on<DidCommConnectionStateChangedEvent>(
    DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    ({ payload }) =>
      stateUpdated(
        EventType.ConnectionStateUpdated,
        toConnectionDto(payload.connectionRecord),
        payload.previousState,
      ),
  )

  agent.events.on<DidCommProofStateChangedEvent>(DidCommProofEventTypes.ProofStateChanged, ({ payload }) =>
    stateUpdated(
      EventType.PresentationStateUpdated,
      toPresentationDto(agent, payload.proofRecord),
      payload.previousState,
    ),
  )

  agent.events.on<DidCommCredentialStateChangedEvent>(
    DidCommCredentialEventTypes.DidCommCredentialStateChanged,
    ({ payload }) =>
      stateUpdated(
        EventType.CredentialExchangeStateUpdated,
        toCredentialExchangeDto(agent, payload.credentialExchangeRecord, logger),
        payload.previousState,
      ),
  )

  const basicMessageReceived = ({
    payload,
  }: {
    payload: { basicMessageRecord: DidCommBasicMessageRecord }
  }): void => {
    const record = payload.basicMessageRecord
    if (record.role !== DidCommBasicMessageRole.Receiver) return
    deliver(EventType.MessageReceived, toBasicMessageRecord(record))
  }
  agent.events.on<DidCommBasicMessageStateChangedEvent>(
    DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged,
    basicMessageReceived,
  )
  agent.events.on<DidCommBasicMessageV2StateChangedEvent>(
    DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged,
    basicMessageReceived,
  )

  // after the handler, before any reply is sent
  agent.didcomm.registerMessageHandlerMiddleware(async (context, next) => {
    await next()
    const { message, connection } = context
    if (!connection) return

    if (message.type === RECEIPTS_MESSAGE_TYPE) {
      const receipts = (message as unknown as ReceiptsMessage).receipts.map(
        ({ messageId, state, timestamp }) => ({
          messageId,
          state,
          timestamp,
        }),
      )
      deliver(EventType.ReceiptsMessageReceived, { connectionId: connection.id, receipts })
      return
    }

    const module = EXTENSION_MODULES[protocolOf(message.type)]
    if (!module) return
    // [VSA-ADM-DC-EXT-4]: one event type per message kind
    deliver(`didcomm.${module}.${messageNameOf(message.type)}-received`, {
      connectionId: connection.id,
      threadId: message.threadId,
      message: message.toJSON(),
    })
  })

  agent.events.on<VsAgentVtFlowStateUpdatedEvent>(
    VsAgentEventTypes.VtFlowStateUpdated,
    async ({ payload }) => {
      const { vtFlowRecordId, state, previousState } = payload.event
      try {
        const record = await agent.modules.vtFlow.findById(vtFlowRecordId)
        if (!record) {
          logger.warn(`event ${EventType.VtFlowStateUpdated} skipped: no flow ${vtFlowRecordId}`)
          return
        }
        deliver(EventType.VtFlowStateUpdated, {
          ...(await resolveV2FlowRecord(agent, record)),
          flowState: state,
          previousState,
        })
      } catch (error) {
        logger.error(`event ${EventType.VtFlowStateUpdated} delivery failed`, { cause: error })
      }
    },
  )
  agent.events.on<VsAgentIndexerNotificationEvent>(VsAgentEventTypes.IndexerNotification, ({ payload }) =>
    deliver(EventType.IndexerNotification, dataOf(payload.event)),
  )
}

const dataOf = ({ type: _type, timestamp: _timestamp, ...data }: Event): Record<string, unknown> => data

const protocolOf = (messageType: string): string => messageType.slice(0, messageType.lastIndexOf('/'))

const messageNameOf = (messageType: string): string => messageType.slice(messageType.lastIndexOf('/') + 1)

const toBasicMessageRecord = (record: DidCommBasicMessageRecord) => ({
  id: record.id,
  connectionId: record.connectionId,
  role: record.role,
  content: record.content,
  sentTime: record.sentTime,
  createdAt: record.createdAt,
})
