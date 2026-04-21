import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { IsOptional, IsString } from 'class-validator'

import { VT_FLOW_VALIDATING_TYPE } from './VtFlowProtocol'

export interface ValidatingMessageOptions {
  /** Defaults to a fresh UUIDv4. */
  id?: string
  threadId: string
  comment?: string
}

/** `validating` — informational Validator status update. No state change. */
export class ValidatingMessage extends DidCommMessage {
  public constructor(options: ValidatingMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.comment = options.comment

      this.setThread({ threadId: options.threadId })
    }
  }

  public static readonly type = parseMessageType(VT_FLOW_VALIDATING_TYPE)

  @IsValidMessageType(ValidatingMessage.type)
  public readonly type = ValidatingMessage.type.messageTypeUri

  @IsOptional()
  @IsString()
  public comment?: string
}
