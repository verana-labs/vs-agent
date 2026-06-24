import { DidCommAttachment, DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { Expose, Type } from 'class-transformer'
import { IsArray, IsInstance, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'

import { VT_FLOW_ISSUANCE_REQUEST_TYPE } from './VtFlowProtocol'

export interface IssuanceRequestMessageOptions {
  id?: string
  schemaId: string
  participantSessionId: string
  agentParticipantId: string
  walletAgentParticipantId: string
  claims?: Record<string, unknown>
  proofsAttach?: DidCommAttachment[]
}

/** Spec `issuance-request`; opens a DirectIssuance session and its `@id` becomes the session `thid`. */
export class IssuanceRequestMessage extends DidCommMessage {
  public constructor(options: IssuanceRequestMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.schemaId = options.schemaId
      this.participantSessionId = options.participantSessionId
      this.agentParticipantId = options.agentParticipantId
      this.walletAgentParticipantId = options.walletAgentParticipantId
      this.claims = options.claims
      this.proofsAttach = options.proofsAttach
    }
  }

  public static readonly type = parseMessageType(VT_FLOW_ISSUANCE_REQUEST_TYPE)

  @IsValidMessageType(IssuanceRequestMessage.type)
  public readonly type = IssuanceRequestMessage.type.messageTypeUri

  @Expose({ name: 'schema_id' })
  @IsString()
  public schemaId!: string

  @Expose({ name: 'participant_session_id' })
  @IsUUID('4')
  public participantSessionId!: string

  @Expose({ name: 'agent_participant_id' })
  @IsString()
  public agentParticipantId!: string

  @Expose({ name: 'wallet_agent_participant_id' })
  @IsString()
  public walletAgentParticipantId!: string

  @IsOptional()
  @IsObject()
  public claims?: Record<string, unknown>

  @Expose({ name: 'proofs~attach' })
  @Type(() => DidCommAttachment)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @IsInstance(DidCommAttachment, { each: true })
  public proofsAttach?: DidCommAttachment[]
}
