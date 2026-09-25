import { EventEnvelope, UnknownEventEnvelope } from '@verana-labs/vs-agent-client'

export interface EventHandler {
  newConnection(connectionId: string): Promise<void> | void
  closeConnection(connectionId: string): Promise<void> | void
  onEvent(envelope: EventEnvelope | UnknownEventEnvelope): Promise<void> | void
}
