import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import { Expose } from 'class-transformer'
import { IsObject, IsOptional, IsString } from 'class-validator'

import { Event } from './Event'
import { EventType } from './EventType'

export const ExtendedDidExchangeState = {
  ...DidCommDidExchangeState,
  Terminated: 'terminated',
  Updated: 'updated',
} as const

export type ExtendedDidExchangeState =
  (typeof ExtendedDidExchangeState)[keyof typeof ExtendedDidExchangeState]

export interface ConnectionStateUpdatedOptions {
  connectionId: string
  state: ExtendedDidExchangeState
  timestamp?: Date
  invitationId?: string
  metadata?: Record<string, string>
}

export class ConnectionStateUpdated extends Event {
  public constructor(options: ConnectionStateUpdatedOptions) {
    super()

    if (options) {
      this.connectionId = options.connectionId
      this.state = options.state
      this.timestamp = options.timestamp ?? new Date()
      this.invitationId = options.invitationId
      this.metadata = options.metadata
    }
  }

  public readonly type = ConnectionStateUpdated.type
  public static readonly type = EventType.ConnectionStateUpdated

  @Expose()
  @IsString()
  public connectionId!: string

  @Expose()
  @IsString()
  public invitationId?: string

  @Expose()
  @IsString()
  public state!: ExtendedDidExchangeState

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, string>
}
