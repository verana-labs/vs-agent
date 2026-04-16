import { Expose, Type, Transform } from 'class-transformer'
import { IsArray, IsDate, IsInstance, IsString, ValidateNested } from 'class-validator'

import { DateParser } from '../utils'

import { BaseMessage } from './BaseMessage'
import { MessageType } from './MessageType'

export interface VsAgentMessageReactionOptions {
  messageId: string
  emoji: string
  action: string // 'react' | 'unreact'
  timestamp?: Date
}

export class VsAgentMessageReaction {
  public constructor(options: VsAgentMessageReactionOptions) {
    if (options) {
      this.messageId = options.messageId
      this.emoji = options.emoji
      this.action = options.action
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  @Expose({ name: 'message_id' })
  @IsString()
  public messageId!: string

  @IsString()
  public emoji!: string

  @IsString()
  public action!: string

  @IsDate()
  @Transform(({ value }) => DateParser(value))
  public timestamp!: Date
}

export interface ReactionMessageOptions {
  id?: string
  threadId?: string
  connectionId: string
  timestamp?: Date
  reactions: VsAgentMessageReactionOptions[]
}

export class ReactionMessage extends BaseMessage {
  public constructor(options: ReactionMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.threadId = options.threadId
      this.timestamp = options.timestamp ?? new Date()
      this.connectionId = options.connectionId
      this.reactions = options.reactions.map(r => new VsAgentMessageReaction(r))
    }
  }

  public readonly type = ReactionMessage.type
  public static readonly type = MessageType.ReactionMessage

  @Expose()
  @Type(() => VsAgentMessageReaction)
  @IsArray()
  @ValidateNested()
  @IsInstance(VsAgentMessageReaction, { each: true })
  public reactions!: VsAgentMessageReaction[]
}
