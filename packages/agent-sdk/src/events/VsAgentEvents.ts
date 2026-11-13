import type { VsAgent } from '../agent/VsAgent'
import type { BaseEvent } from '@credo-ts/core'
import type { DidCommProofExchangeRecord, DidCommProofState } from '@credo-ts/didcomm'

import {
  BaseMessage,
  ConnectionStateUpdated,
  Event,
  IndexerNotification,
  InvitationStateUpdated,
  MessageReceived,
  PresentationStateUpdated,
  VtFlowStateUpdated,
} from '@verana-labs/vs-agent-model'

export enum VsAgentEventTypes {
  ConnectionStateUpdated = 'vs-agent-connection-state-updated',
  InvitationStateUpdated = 'vs-agent-invitation-state-updated',
  MessageReceived = 'vs-agent-message-received',
  PresentationStateUpdated = 'vs-agent-presentation-state-updated',
  PresentationTrustDecided = 'vs-agent-presentation-trust-decided',
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
export interface VsAgentInvitationStateUpdatedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.InvitationStateUpdated
  payload: {
    event: InvitationStateUpdated
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
/**
 * The trust decision of [VSA-VTI-FLOW-VERIFY-AC-7] succeeded for a received presentation. Credo
 * emits the change to `presentation-received` before the decision runs, so a listener that needs
 * the verified credentials of the record waits for this event.
 */
export interface VsAgentPresentationTrustDecidedEvent extends BaseEvent {
  type: typeof VsAgentEventTypes.PresentationTrustDecided
  payload: {
    proofRecord: DidCommProofExchangeRecord
    previousState: DidCommProofState
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
