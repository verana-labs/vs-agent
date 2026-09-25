import {
  DidCommProblemReportMessage,
  ImpactStatus,
  IsValidMessageType,
  WhereStatus,
  WhoRetriesStatus,
  parseMessageType,
} from '@credo-ts/didcomm'
import { Transform, TransformationType } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

import { VT_FLOW_PROBLEM_REPORT_TYPE } from './VtFlowProtocol'

// RFC 0035 values are lower case on the wire, while Credo's enums and their IsEnum checks are upper case.
function rfc0035Case({ value, type }: { value: unknown; type: TransformationType }): unknown {
  if (typeof value !== 'string') return value
  return type === TransformationType.CLASS_TO_PLAIN ? value.toLowerCase() : value.toUpperCase()
}

/**
 * Spec `problem-report (adopted)`. Credo's base class is typed
 * `notification/1.0/problem-report`, which is not the `report-problem/1.0` URI the vt-flow
 * Message Type URIs table requires, and a handler keys on the message class.
 */
export class VtFlowProblemReportMessage extends DidCommProblemReportMessage {
  public static readonly type = parseMessageType(VT_FLOW_PROBLEM_REPORT_TYPE)

  @IsValidMessageType(VtFlowProblemReportMessage.type)
  public readonly type = VtFlowProblemReportMessage.type.messageTypeUri

  @Transform(rfc0035Case)
  public whoRetries?: WhoRetriesStatus

  @Transform(rfc0035Case)
  public impact?: ImpactStatus

  // RFC 0035 where is a compound value such as 'you - agency', which Credo's WhereStatus enum rejects
  @IsOptional()
  @IsString()
  public where?: WhereStatus
}
