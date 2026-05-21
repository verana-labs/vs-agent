import { Expose } from 'class-transformer'
import { IsObject, IsOptional, IsString } from 'class-validator'

import { Event } from './Event'
import { EventType } from './EventType'

export interface VtFlowStateUpdatedOptions {
  vtFlowRecordId: string
  threadId: string
  sessionUuid: string
  connectionId: string
  role: string
  variant: string
  state: string
  previousState?: string | null
  permId?: string
  schemaId?: string
  claims?: Record<string, unknown>
  credentialExchangeRecordId?: string
  timestamp?: Date
}

export class VtFlowStateUpdated extends Event {
  public constructor(options: VtFlowStateUpdatedOptions) {
    super()

    if (options) {
      this.vtFlowRecordId = options.vtFlowRecordId
      this.threadId = options.threadId
      this.sessionUuid = options.sessionUuid
      this.connectionId = options.connectionId
      this.role = options.role
      this.variant = options.variant
      this.state = options.state
      this.previousState = options.previousState ?? undefined
      this.permId = options.permId
      this.schemaId = options.schemaId
      this.claims = options.claims
      this.credentialExchangeRecordId = options.credentialExchangeRecordId
      this.timestamp = options.timestamp ?? new Date()
    }
  }

  public readonly type = VtFlowStateUpdated.type
  public static readonly type = EventType.VtFlowStateUpdated

  @Expose()
  @IsString()
  public vtFlowRecordId!: string

  @Expose()
  @IsString()
  public threadId!: string

  @Expose()
  @IsString()
  public sessionUuid!: string

  @Expose()
  @IsString()
  public connectionId!: string

  @Expose()
  @IsString()
  public role!: string

  @Expose()
  @IsString()
  public variant!: string

  @Expose()
  @IsString()
  public state!: string

  @Expose()
  @IsOptional()
  @IsString()
  public previousState?: string

  @Expose()
  @IsOptional()
  @IsString()
  public permId?: string

  @Expose()
  @IsOptional()
  @IsString()
  public schemaId?: string

  @Expose()
  @IsOptional()
  @IsObject()
  public claims?: Record<string, unknown>

  @Expose()
  @IsOptional()
  @IsString()
  public credentialExchangeRecordId?: string
}
