import type { BaseLogger } from '@credo-ts/core'
import type {
  DidCommBasicMessageRecord,
  DidCommBasicMessageStateChangedEvent,
  DidCommBasicMessageV2StateChangedEvent,
  DidCommConnectionStateChangedEvent,
  DidCommCredentialStateChangedEvent,
  DidCommMessageProcessedEvent,
  DidCommProofStateChangedEvent,
} from '@credo-ts/didcomm'
import type { Event } from '@verana-labs/vs-agent-model'

import { utils } from '@credo-ts/core'
import {
  DidCommBasicMessageEventTypes,
  DidCommBasicMessageRole,
  DidCommConnectionEventTypes,
  DidCommCredentialEventTypes,
  DidCommEventTypes,
  DidCommProofEventTypes,
} from '@credo-ts/didcomm'
import { EventType } from '@verana-labs/vs-agent-model'
import {
  VsAgent,
  VsAgentEventTypes,
  VsAgentIndexerNotificationEvent,
  VsAgentPresentationStateUpdatedEvent,
  VsAgentVtFlowStateUpdatedEvent,
} from '@verana-labs/vs-agent-sdk'

import {
  toConnectionDto,
  toCredentialExchangeDto,
  toPresentationDto,
} from '../controllers/admin/v2/didcomm/mappers'

export interface WebhookOptions {
  url: string
  apiKey?: string
}

// [VSA-ADM-DC-EXT-4] module path segment of each extension protocol the agent serves
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

  agent.events.on<DidCommMessageProcessedEvent>(DidCommEventTypes.DidCommMessageProcessed, ({ payload }) => {
    const { message, connection } = payload
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
    deliver(`didcomm.${module}.message-received`, {
      connectionId: connection.id,
      threadId: message.threadId,
      message: message.toJSON(),
    })
  })

  agent.events.on<VsAgentVtFlowStateUpdatedEvent>(VsAgentEventTypes.VtFlowStateUpdated, ({ payload }) =>
    deliver(EventType.VtFlowStateUpdated, dataOf(payload.event)),
  )
  agent.events.on<VsAgentIndexerNotificationEvent>(VsAgentEventTypes.IndexerNotification, ({ payload }) =>
    deliver(EventType.IndexerNotification, dataOf(payload.event)),
  )
}

export const presentationCallback = (agent: VsAgent, logger: BaseLogger) => {
  agent.events.on<VsAgentPresentationStateUpdatedEvent>(
    VsAgentEventTypes.PresentationStateUpdated,
    async ({ payload }) => {
      const { callbackUrl, ref, claims, state, verified, proofExchangeId } = payload.event
      if (!callbackUrl) return

      const body = { ref, claims, state, verified, proofExchangeId }
      try {
        logger.debug(`sending presentation callback event to ${callbackUrl}: ${JSON.stringify(body)}`)
        await fetch(callbackUrl, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        logger.error(`sending presentation callback event to ${callbackUrl}`, { cause: error })
      }
    },
  )
}

const dataOf = ({ type: _type, timestamp: _timestamp, ...data }: Event): Record<string, unknown> => data

const protocolOf = (messageType: string): string => messageType.slice(0, messageType.lastIndexOf('/'))

const toBasicMessageRecord = (record: DidCommBasicMessageRecord) => ({
  id: record.id,
  connectionId: record.connectionId,
  role: record.role,
  content: record.content,
  sentTime: record.sentTime,
  createdAt: record.createdAt,
})
