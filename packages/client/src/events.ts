import { EventEnvelope, EventHandlerFn, EventType, UnknownEventEnvelope } from './types'

type AnyHandler = (data: unknown, envelope: EventEnvelope | UnknownEventEnvelope) => void | Promise<void>

const EVENT_TYPES: Record<EventType, true> = {
  'didcomm.connections.state-updated': true,
  'didcomm.basic-messages.message-received': true,
  'didcomm.receipts.message-receipts-received': true,
  'didcomm.reactions.message-reactions-received': true,
  'didcomm.user-profile.profile-received': true,
  'didcomm.user-profile.request-profile-received': true,
  'didcomm.media-sharing.share-media-received': true,
  'didcomm.media-sharing.request-media-received': true,
  'didcomm.calls.call-offer-received': true,
  'didcomm.calls.call-accept-received': true,
  'didcomm.calls.call-reject-received': true,
  'didcomm.calls.call-end-received': true,
  'didcomm.action-menu.menu-request-received': true,
  'didcomm.action-menu.perform-received': true,
  'didcomm.question-answer.answer-received': true,
  'didcomm.mrtd.mrz-data-received': true,
  'didcomm.mrtd.emrtd-data-received': true,
  'didcomm.mrtd.problem-report-received': true,
  'didcomm.presentations.state-updated': true,
  'didcomm.credential-exchanges.state-updated': true,
  'vt.flows.state-updated': true,
  'vpr.notification': true,
}

export function isEventEnvelope(envelope: EventEnvelope | UnknownEventEnvelope): envelope is EventEnvelope {
  return envelope.type in EVENT_TYPES
}

export class EventDispatcher {
  private readonly handlers = new Map<string, AnyHandler[]>()

  public on<T extends EventType>(type: T, handler: EventHandlerFn<T>): this {
    const list = this.handlers.get(type) ?? []
    list.push(handler as AnyHandler)
    this.handlers.set(type, list)
    return this
  }

  public async dispatch(envelope: EventEnvelope | UnknownEventEnvelope): Promise<void> {
    for (const handler of this.handlers.get(envelope.type) ?? []) {
      await handler(envelope.data, envelope)
    }
  }
}
