import { MessageState } from '@credo-ts/didcomm-receipts'
import { Expose, Type, Transform } from 'class-transformer'
import { IsInstance, IsArray, IsDate, IsString, ValidateNested } from 'class-validator'

import { DateParser } from '../utils'

import { BaseMessage } from './BaseMessage'
import { MessageType } from './MessageType'

// FIXME: Do a better conversion between DIDComm protocol and VS Agent protocol constants
export const didcommMessageState: Record<string, MessageState> = {
  created: MessageState.Created,
  deleted: MessageState.Deleted,
  received: MessageState.Received,
  submitted: MessageState.Submitted,
  viewed: MessageState.Viewed,
}

export interface VsAgentMessageReceiptOptions {
  messageId: string
  state: string
  timestamp: Date
}

export class VsAgentMessageReceipt {
  public constructor(options: VsAgentMessageReceiptOptions) {
    if (options) {
      this.messageId = options.messageId
      this.state = options.state
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  @Expose({ name: 'message_id' })
  @IsString()
  public messageId!: string

  @IsString()
  public state!: string

  @IsDate()
  @Transform(({ value }) => DateParser(value))
  public timestamp!: Date
}

export interface ReceiptsMessageOptions {
  id?: string
  threadId?: string
  connectionId: string
  timestamp?: Date
  receipts: VsAgentMessageReceiptOptions[]
}

export class ReceiptsMessage extends BaseMessage {
  public constructor(options: ReceiptsMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.threadId = options.threadId
      this.timestamp = options.timestamp ?? new Date()
      this.connectionId = options.connectionId
      this.receipts = options.receipts
    }
  }

  public readonly type = ReceiptsMessage.type
  public static readonly type = MessageType.ReceiptsMessage

  @Expose()
  @Type(() => VsAgentMessageReceipt)
  @IsArray()
  @ValidateNested()
  @IsInstance(VsAgentMessageReceipt, { each: true })
  public receipts!: VsAgentMessageReceipt[]
}
