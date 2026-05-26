import type { VsAgent } from '../agent/VsAgent'
import type { BaseEvent } from '@credo-ts/core'

import {
  BaseMessage,
  ConnectionStateUpdated,
  Event,
  MessageReceived,
  MessageStateUpdated,
  PresentationStatusUpdated,
} from '@verana-labs/vs-agent-model'

export enum VsAgentEventTypes {
  ConnectionStateUpdated = 'vs-agent-connection-state-updated',
  MessageReceived = 'vs-agent-message-received',
  MessageStateUpdated = 'vs-agent-message-state-updated',
  PresentationStatusUpdated = 'vs-agent-presentation-status-updated',
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
export interface VsAgentPresentationStatusUpdatedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.PresentationStatusUpdated
  payload: {
    event: PresentationStatusUpdated
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
