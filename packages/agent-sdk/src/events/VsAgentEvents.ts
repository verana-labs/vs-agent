import type { VsAgent } from '../agent/VsAgent'
import type { BaseEvent } from '@credo-ts/core'

import {
  BaseMessage,
  ConnectionStateUpdated,
  Event,
  IndexerNotification,
  MessageReceived,
  PresentationStateUpdated,
  VtFlowStateUpdated,
} from '@verana-labs/vs-agent-model'

export enum VsAgentEventTypes {
  ConnectionStateUpdated = 'vs-agent-connection-state-updated',
  MessageReceived = 'vs-agent-message-received',
  PresentationStateUpdated = 'vs-agent-presentation-state-updated',
  VtFlowStateUpdated = 'vs-agent-vt-flow-state-updated',
  IndexerNotification = 'vs-agent-indexer-notification',
}

export interface VsAgentConnectionStateEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.ConnectionStateUpdated
  payload: {
    event: ConnectionStateUpdated
  }
}
export interface VsAgentMessageReceivedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.MessageReceived
  payload: {
    event: MessageReceived
  }
}
export interface VsAgentPresentationStateUpdatedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.PresentationStateUpdated
  payload: {
    event: PresentationStateUpdated
  }
}
export interface VsAgentVtFlowStateUpdatedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.VtFlowStateUpdated
  payload: {
    event: VtFlowStateUpdated
  }
}
export interface VsAgentIndexerNotificationEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.IndexerNotification
  payload: {
    event: IndexerNotification
  }
}

export function msgToEvent(message: BaseMessage): MessageReceived {
  return new MessageReceived({
    timestamp: message.timestamp,
    message,
  })
}

export function emitVsAgentEvent(agent: VsAgent, type: VsAgentEventTypes, event: Event): void {
  agent.events.emit(agent.context, { type, payload: { event } })
}
