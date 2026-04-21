import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

import { VT_FLOW_CREDENTIAL_STATE_CHANGE_TYPE } from './VtFlowProtocol'

/** Open enum. v1.0 defines `REVOKED`; receivers must accept unknown values. */
export enum VtCredentialState {
  Revoked = 'REVOKED',
}

export interface CredentialStateChangeMessageOptions {
  /** Defaults to a fresh UUIDv4. */
  id?: string
  threadId: string
  /** `thid` of the Issue Credential V2 exchange that issued the credential. */
  subprotocolThid: string
  state: VtCredentialState | string
  reason?: string
}

/** `credential-state-change` — post-issuance Validator => Applicant notification. */
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
