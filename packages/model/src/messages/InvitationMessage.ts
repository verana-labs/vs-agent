import { IsString, IsOptional } from 'class-validator'

import { BaseMessage, BaseMessageOptions } from './BaseMessage'
import { MessageType } from './MessageType'

export interface InvitationMessageOptions extends BaseMessageOptions {
  label?: string
  imageUrl?: string
  did?: string
}

/**
 * @deprecated Use `POST /v2/didcomm/invitations` to send an invitation.
 */
export class InvitationMessage extends BaseMessage {
  public constructor(options: InvitationMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.threadId = options.threadId
      this.timestamp = options.timestamp ?? new Date()
      this.connectionId = options.connectionId
      this.label = options.label
      this.imageUrl = options.imageUrl
      this.did = options.did
    }
  }

  public readonly type = InvitationMessage.type
  public static readonly type = MessageType.InvitationMessage

  @IsString()
  @IsOptional()
  public label?: string

  @IsString()
  @IsOptional()
  public imageUrl?: string

  @IsString()
  @IsOptional()
  public did?: string
}
