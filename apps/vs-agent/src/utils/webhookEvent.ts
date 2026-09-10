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
  VsAgentModuleMessageReceivedEvent,
  VsAgentVtFlowStateUpdatedEvent,
} from '@verana-labs/vs-agent-sdk'

import { resolveV2FlowRecord } from '../controllers/admin/vt-flow/VtFlowsService'

import {
  toBasicMessageDto,
  toConnectionDto,
  toCredentialExchangeDto,
  toPresentationDto,
} from '../controllers/admin/v2/didcomm/mappers'

import { registerDidcommModuleEvents } from './didcommModuleEvents'

export interface WebhookOptions {
  url: string
  apiKey?: string
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
    deliver(EventType.MessageReceived, toBasicMessageDto(record))
  }
  agent.events.on<DidCommBasicMessageStateChangedEvent>(
    DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged,
    basicMessageReceived,
  )
  agent.events.on<DidCommBasicMessageV2StateChangedEvent>(
    DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged,
    basicMessageReceived,
  )

  registerDidcommModuleEvents(agent, deliver)

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
  agent.events.on<VsAgentModuleMessageReceivedEvent>(VsAgentEventTypes.ModuleMessageReceived, ({ payload }) =>
    deliver(payload.type, payload.data),
  )
}

const dataOf = ({ type: _type, ...data }: Event): Record<string, unknown> => data
