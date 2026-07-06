import { Expose } from 'class-transformer'

import { Event } from './Event'
import { EventType } from './EventType'

export interface IndexerNotificationOptions {
  msg: string
  entityType: string
  entityId: string
  changes: Record<string, unknown>
  blockHeight: number
  txHash: string
  operatorAddress: string
  timestamp?: Date
}

export class IndexerNotification extends Event {
  public constructor(options: IndexerNotificationOptions) {
    super()

    if (options) {
      this.msg = options.msg
      this.entityType = options.entityType
      this.entityId = options.entityId
      this.changes = options.changes
      this.blockHeight = options.blockHeight
      this.txHash = options.txHash
      this.operatorAddress = options.operatorAddress
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  public readonly type = IndexerNotification.type
  public static readonly type = EventType.IndexerNotification

  @Expose()
  public msg!: string

  @Expose()
  public entityType!: string

  @Expose()
  public entityId!: string

  @Expose()
  public changes!: Record<string, unknown>

  @Expose()
  public blockHeight!: number

  @Expose()
  public txHash!: string

  @Expose()
  public operatorAddress!: string
}
