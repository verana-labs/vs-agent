import type { VsAgent } from '../agent/VsAgent'
import type { BaseEvent } from '@credo-ts/core'

import {
  BaseMessage,
  ConnectionStateUpdated,
  Event,
  EventType,
  MessageReceived,
  MessageStateUpdated,
} from '@verana-labs/vs-agent-model'

// Bus channel names for VS Agent domain events.
export enum VsAgentEventType {
  ConnectionStateUpdated = 'vs-agent-connection-state-updated',
  MessageReceived = 'vs-agent-message-received',
  MessageStateUpdated = 'vs-agent-message-state-updated',
}

export const busTypeByEventType: Record<EventType, VsAgentEventType> = {
  [EventType.ConnectionState]: VsAgentEventType.ConnectionStateUpdated,
  [EventType.MessageStateUpdated]: VsAgentEventType.MessageStateUpdated,
  [EventType.MessageReceived]: VsAgentEventType.MessageReceived,
}

interface VsAgentDomainEvent<T extends VsAgentEventType, E extends Event> extends BaseEvent {
  type: T
  payload: { event: E }
}

export type VsAgentConnectionStateEvent = VsAgentDomainEvent<
  VsAgentEventType.ConnectionStateUpdated,
  ConnectionStateUpdated
>
export type VsAgentMessageReceivedEvent = VsAgentDomainEvent<
  VsAgentEventType.MessageReceived,
  MessageReceived
>
export type VsAgentMessageStateUpdatedEvent = VsAgentDomainEvent<
  VsAgentEventType.MessageStateUpdated,
  MessageStateUpdated
>

export type VsAgentEvent =
  | VsAgentConnectionStateEvent
  | VsAgentMessageReceivedEvent
  | VsAgentMessageStateUpdatedEvent

/**
 * Publishes a VS Agent domain event on the agent's native credo event bus.
 * The host app subscribes via `agent.events.on(VsAgentEventType.X, ...)` to deliver webhooks,
 * run callbacks, log, etc.
 */
export function emitVsAgentEvent(agent: VsAgent, eventOrMessage: Event | BaseMessage): void {
  const event =
    eventOrMessage instanceof Event
      ? eventOrMessage
      : new MessageReceived({ timestamp: eventOrMessage.timestamp, message: eventOrMessage })

  agent.events.emit(agent.context, {
    type: busTypeByEventType[event.type],
    payload: { event },
  })
}
