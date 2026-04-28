import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { Expose, Transform } from 'class-transformer'
import { IsDate, IsOptional, IsString, IsUrl } from 'class-validator'

import { VT_FLOW_OOB_LINK_TYPE } from './VtFlowProtocol'

export interface OobLinkMessageOptions {
  id?: string
  threadId: string
  url: string
  description: string
  expiresTime?: Date
}

/** Spec v4 §5.5 `oob-link`; Validator asks the Applicant to complete an action outside DIDComm, threaded on the vt-flow session `thid`. */
export class OobLinkMessage extends DidCommMessage {
  public constructor(options: OobLinkMessageOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.url = options.url
      this.description = options.description
      this.expiresTime = options.expiresTime

      this.setThread({ threadId: options.threadId })
    }
  }

  public static readonly type = parseMessageType(VT_FLOW_OOB_LINK_TYPE)

  @IsValidMessageType(OobLinkMessage.type)
  public readonly type = OobLinkMessage.type.messageTypeUri

  @IsUrl({ require_tld: false, protocols: ['https'] })
  public url!: string

  @IsString()
  public description!: string

  @Expose({ name: 'expires_time' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? new Date(value) : value))
  @IsOptional()
  @IsDate()
  public expiresTime?: Date
}
