import { BaseMessage, Event, MessageReceived } from '@verana-labs/vs-agent-model'

/**
 * Low-level delivery contract. Implemented by the host app (e.g. POSTing to a webhook),
 * so plugins never deal with the transport themselves.
 */
export type EventSink = (event: Event) => void | Promise<void>

/**
 * Single entry point that plugins use to publish events. It is polymorphic on its argument:
 *  - an {@link Event} (e.g. MessageStateUpdated, ConnectionStateUpdated) is delivered as-is
 *  - a raw domain {@link BaseMessage} is wrapped into a {@link MessageReceived} event
 *
 * The concrete delivery mechanism is the {@link EventSink} injected by the app, keeping
 * plugins decoupled from webhooks/HTTP.
 */
export class EventEmitter {
  public constructor(private readonly sink: EventSink) {}

  public emit(event: Event): Promise<void>
  public emit(message: BaseMessage): Promise<void>
  public async emit(eventOrMessage: Event | BaseMessage): Promise<void> {
    const event =
      eventOrMessage instanceof Event
        ? eventOrMessage
        : new MessageReceived({ timestamp: eventOrMessage.timestamp, message: eventOrMessage })
    await this.sink(event)
  }
}
