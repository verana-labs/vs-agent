import { DidCommAttachment, DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { Expose, Type } from 'class-transformer'
import { IsArray, IsInstance, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'

import { VT_FLOW_VALIDATION_REQUEST_TYPE } from './VtFlowProtocol'

export interface ValidationRequestMessageOptions {
  id?: string
  permId: string
  sessionUuid: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
  proofsAttach?: DidCommAttachment[]
}

/** Spec v4 §5.1 `validation-request`; opens a ValidationProcess session and its `@id` becomes the session `thid`. */
export class ValidationRequestMessage extends DidCommMessage {
  public constructor(options: ValidationRequestMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.permId = options.permId
      this.sessionUuid = options.sessionUuid
      this.agentPermId = options.agentPermId
      this.walletAgentPermId = options.walletAgentPermId
      this.claims = options.claims
      this.proofsAttach = options.proofsAttach
    }
  }

  public static readonly type = parseMessageType(VT_FLOW_VALIDATION_REQUEST_TYPE)

  @IsValidMessageType(ValidationRequestMessage.type)
  public readonly type = ValidationRequestMessage.type.messageTypeUri

  @Expose({ name: 'perm_id' })
  @IsString()
  public permId!: string

  @Expose({ name: 'session_uuid' })
  @IsUUID('4')
  public sessionUuid!: string

  @Expose({ name: 'agent_perm_id' })
  @IsString()
  public agentPermId!: string

  @Expose({ name: 'wallet_agent_perm_id' })
  @IsString()
  public walletAgentPermId!: string

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
