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
  ModuleMessageReceived = 'vs-agent-module-message-received',
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

export interface VsAgentModuleMessageReceivedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.ModuleMessageReceived
  payload: {
    type: string
    data: Record<string, unknown>
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

export function emitModuleMessageEvent(
  agent: VsAgent<any>,
  type: string,
  data: Record<string, unknown>,
): void {
  agent.events.emit(agent.context, {
    type: VsAgentEventTypes.ModuleMessageReceived,
    payload: { type, data },
  })
}
