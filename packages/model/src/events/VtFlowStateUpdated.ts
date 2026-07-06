import { Expose } from 'class-transformer'
import { IsObject, IsOptional, IsString } from 'class-validator'

import { Event } from './Event'
import { EventType } from './EventType'

export interface VtFlowStateUpdatedOptions {
  vtFlowRecordId: string
  threadId: string
  participantSessionId: string
  connectionId: string
  role: string
  variant: string
  state: string
  previousState?: string | null
  participantId?: string
  schemaId?: string
  claims?: Record<string, unknown>
  credentialExchangeRecordId?: string
  errorMessage?: string
  subprotocolThid?: string
  agentParticipantId?: string
  walletAgentParticipantId?: string
  timestamp?: Date
}

export class VtFlowStateUpdated extends Event {
  public constructor(options: VtFlowStateUpdatedOptions) {
    super()

    if (options) {
      this.vtFlowRecordId = options.vtFlowRecordId
      this.threadId = options.threadId
      this.participantSessionId = options.participantSessionId
      this.connectionId = options.connectionId
      this.role = options.role
      this.variant = options.variant
      this.state = options.state
      this.previousState = options.previousState ?? undefined
      this.participantId = options.participantId
      this.schemaId = options.schemaId
      this.claims = options.claims
      this.credentialExchangeRecordId = options.credentialExchangeRecordId
      this.errorMessage = options.errorMessage
      this.subprotocolThid = options.subprotocolThid
      this.agentParticipantId = options.agentParticipantId
      this.walletAgentParticipantId = options.walletAgentParticipantId
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
  public participantSessionId!: string

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
  public participantId?: string

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

  @Expose()
  @IsOptional()
  @IsString()
  public errorMessage?: string

  @Expose()
  @IsOptional()
  @IsString()
  public subprotocolThid?: string

  @Expose()
  @IsOptional()
  @IsString()
  public agentParticipantId?: string

  @Expose()
  @IsOptional()
  @IsString()
  public walletAgentParticipantId?: string
}
