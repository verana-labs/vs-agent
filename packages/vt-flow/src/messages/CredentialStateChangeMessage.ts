import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

import { VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE } from './VtFlowProtocol'

/** Open enum of credential states carried by `credential-state-change`; v1.0 defines `REVOKED` and receivers must tolerate unknown values. */
export enum VtCredentialState {
  Revoked = 'REVOKED',
}

export interface CredentialStateChangeMessageOptions {
  id?: string
  threadId: string
  subprotocolThid: string
  state: VtCredentialState | string
  reason?: string
}

/** Spec v4 §5.3 `credential-state-change`; Validator => Applicant post-issuance notification referencing the IC V2 subprotocol `thid`. */
export class CredentialStateChangeMessage extends DidCommMessage {
  public constructor(options: CredentialStateChangeMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.subprotocolThid = options.subprotocolThid
      this.state = options.state
      this.reason = options.reason

      this.setThread({ threadId: options.threadId })
    }
  }

  public static readonly type = parseMessageType(VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE)

  @IsValidMessageType(CredentialStateChangeMessage.type)
  public readonly type = CredentialStateChangeMessage.type.messageTypeUri

  @Expose({ name: 'subprotocol_thid' })
  @IsString()
  public subprotocolThid!: string

  @IsString()
  public state!: VtCredentialState | string

  @IsOptional()
  @IsString()
  public reason?: string
}
