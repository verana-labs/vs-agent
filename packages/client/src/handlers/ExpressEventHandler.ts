import { EventType } from '@verana-labs/vs-agent-model'
import { Express, Request, Response } from 'express'

type Handler = (req: Request, res: Response) => Promise<void>

/**
 * `ExpressEventHandler` class for defining express event handling methods.
 * Extend this class in other projects to implement specific endpoint handlers
 * for different types of events. Each method is mapped to an HTTP POST endpoint
 * with a specified route on express structure
 *
 * Usage:
 * Extend `EventHandler` in your subclass and implement each method to
 * handle incoming events as per the business requirements.
 */
export class ExpressEventHandler {
  private app: Express

  constructor(app: Express) {
    this.app = app
  }

  /**
   * Handles the event for updating the state of a connection.
   *
   * Endpoint: POST `/connection-state-updated`
   * Expected Payload: an `Event` object containing the connection state update details.
   *
   * @param {Event} event - The event object containing the connection state update details.
   * @throws {Error} Throws an error if not implemented by subclass.
   * @example
   * const event = {
   * 	 type: "connection-state-updated",
   *   connectionId: "e2037401-aa91-4302-8927-ac07f06d9d60",
   *   invitationId: "2232eb0f-643b-4a00-b014-3d1d85b8f4de",
   *   state: "completed",
   * }
   */
  public connectionState(handler: Handler) {
    this.app.post(`/${EventType.ConnectionStateUpdated}`, async (req: Request, res: Response) => {
      try {
        await handler(req, res)
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error', error })
      }
    })
  }

  /**
   * Handles the event for updating the state of a message.
   *
   * Endpoint: POST `/message-state-updated`
   * Expected Payload: an `Event` object containing the new message state details.
   *
   * @param {Event} event - The event object containing the message state update details.
   * @throws {Error} Throws an error if not implemented by subclass.
   * @example
   * const event = {
   * 	 type: "message-state-updated",
   *   messageId: "12345",
   *   state: "delivered",
   *   timestamp: "2023-10-01T12:00:00Z",
   *   connectionId: "conn123"
   * }
   */
  public messageStateUpdated(handler: Handler) {
    this.app.post(`/${EventType.MessageStateUpdated}`, async (req: Request, res: Response) => {
      try {
        await handler(req, res)
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error', error })
      }
    })
  }

  /**
   * Handles the event when a new message is received.
   *
   * Endpoint: POST `/message-received`
   * Expected Payload: an `Event` object containing the message details.
   *
   * @param {Event} event - The event object containing the message details.
   * @throws {Error} Throws an error if not implemented by subclass.
   * @example
   * const event = {
   * 	 type: "message-received",
   *   message: {
   * 		type: text,
   * 		content: "test"
   * 	 },
   *   timestamp: "2023-10-01T12:00:00Z",
   * }
   */
  public messageReceived(handler: Handler) {
    this.app.post(`/${EventType.MessageReceived}`, async (req: Request, res: Response) => {
      try {
        await handler(req, res)
      } catch (error) {
        res.status(500).json({ message: 'Internal Server Error', error })
      }
    })
  }
}
