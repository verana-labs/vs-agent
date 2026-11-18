import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

import { Event } from './Event'
import { EventType } from './EventType'

export interface InvitationStateUpdatedOptions {
  invitationRecordId: string
  state: string
  previousState?: string | null
  timestamp?: Date
}

export class InvitationStateUpdated extends Event {
  public constructor(options: InvitationStateUpdatedOptions) {
    super()
    if (options) {
      this.invitationRecordId = options.invitationRecordId
      this.state = options.state
      this.previousState = options.previousState ?? null
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  public readonly type = InvitationStateUpdated.type
  public static readonly type = EventType.InvitationStateUpdated

  @Expose()
  @IsString()
  public invitationRecordId!: string

  @Expose()
  @IsString()
  public state!: string

  @Expose()
  @IsOptional()
  @IsString()
  public previousState!: string | null
}
