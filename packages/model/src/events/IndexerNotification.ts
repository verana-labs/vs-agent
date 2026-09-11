import { Expose } from 'class-transformer'

import { Event } from './Event'
import { EventType } from './EventType'

export interface IndexerNotificationPayload {
  module: string
  action: string
  messageType: string
  txIndex: number
  messageIndex: number
  sender: string
  relatedDids: string[]
  entityType?: string
  entityId?: string
}

export interface IndexerNotificationOptions {
  eventType: string
  did: string
  blockHeight: number
  txHash: string
  payload: IndexerNotificationPayload
  changes?: Record<string, unknown>
  timestamp?: Date
}

export class IndexerNotification extends Event {
  public constructor(options: IndexerNotificationOptions) {
    super()

    if (options) {
      this.eventType = options.eventType
      this.did = options.did
      this.blockHeight = options.blockHeight
      this.txHash = options.txHash
      this.timestamp = options.timestamp ?? new Date()
      this.payload = options.payload
      this.changes = options.changes
    }
  }

  public readonly type = IndexerNotification.type
  public static readonly type = EventType.IndexerNotification

  @Expose()
  public eventType!: string

  @Expose()
  public did!: string

  @Expose()
  public blockHeight!: number

  @Expose()
  public txHash!: string

  @Expose()
  public payload!: IndexerNotificationPayload

  @Expose()
  public changes?: Record<string, unknown>
}
