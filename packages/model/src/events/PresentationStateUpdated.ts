import { Expose } from 'class-transformer'
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator'

import { Claim } from '../messages/CredentialIssuanceMessage'

import { Event } from './Event'
import { EventType } from './EventType'

export enum PresentationState {
  OK = 'ok',
  CONNECTED = 'connected',
  SCANNED = 'scanned',
  REFUSED = 'refused',
  NO_COMPATIBLE_CREDENTIALS = 'no-compatible-credentials',
  VERIFICATION_ERROR = 'verification-error',
  UNSPECIFIED_ERROR = 'unspecified-error',
}

export interface PresentationStateUpdatedOptions {
  proofExchangeId: string
  state: PresentationState
  callbackUrl: string
  ref?: string
  claims?: Claim[]
  verified?: boolean
  timestamp?: Date
}

export class PresentationStateUpdated extends Event {
  public constructor(options: PresentationStateUpdatedOptions) {
    super()

    if (options) {
      this.proofExchangeId = options.proofExchangeId
      this.state = options.state
      this.callbackUrl = options.callbackUrl
      this.ref = options.ref
      this.claims = options.claims
      this.verified = options.verified
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  public readonly type = PresentationStateUpdated.type
  public static readonly type = EventType.PresentationStateUpdated

  @Expose()
  @IsString()
  public proofExchangeId!: string

  @Expose()
  @IsString()
  public state!: PresentationState

  @Expose()
  @IsString()
  public callbackUrl!: string

  @Expose()
  @IsOptional()
  @IsString()
  public ref?: string

  @Expose()
  @IsOptional()
  @IsArray()
  public claims?: Claim[]

  @Expose()
  @IsOptional()
  @IsBoolean()
  public verified?: boolean
}
