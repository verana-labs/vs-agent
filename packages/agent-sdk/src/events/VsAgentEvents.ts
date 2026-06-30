import type { VsAgent } from '../agent/VsAgent'
import type { BaseEvent } from '@credo-ts/core'

import {
  BaseMessage,
  ConnectionStateUpdated,
  Event,
  MessageReceived,
  MessageStateUpdated,
  PresentationStateUpdated,
  VtFlowStateUpdated,
} from '@verana-labs/vs-agent-model'

export enum VsAgentEventTypes {
  ConnectionStateUpdated = 'vs-agent-connection-state-updated',
  MessageReceived = 'vs-agent-message-received',
  MessageStateUpdated = 'vs-agent-message-state-updated',
  PresentationStateUpdated = 'vs-agent-presentation-state-updated',
  VtFlowStateUpdated = 'vs-agent-vt-flow-state-updated',
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
export interface VsAgentMessageStateUpdatedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.MessageStateUpdated
  payload: {
    event: MessageStateUpdated
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

export function msgToEvent(message: BaseMessage): MessageReceived {
  return new MessageReceived({
    timestamp: message.timestamp,
    message,
  })
}

export function emitVsAgentEvent(agent: VsAgent, type: VsAgentEventTypes, event: Event): void {
  agent.events.emit(agent.context, { type, payload: { event } })
}
