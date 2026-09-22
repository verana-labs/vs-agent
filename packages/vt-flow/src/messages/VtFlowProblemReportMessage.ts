import { DidCommProblemReportMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'

import { VT_FLOW_PROBLEM_REPORT_TYPE } from './VtFlowProtocol'

/**
 * Spec `problem-report (adopted)`. Credo's base class is typed
 * `notification/1.0/problem-report`, which is not the `report-problem/1.0` URI the vt-flow
 * Message Type URIs table requires, and a handler keys on the message class.
 */
export class VtFlowProblemReportMessage extends DidCommProblemReportMessage {
  public static readonly type = parseMessageType(VT_FLOW_PROBLEM_REPORT_TYPE)

  @IsValidMessageType(VtFlowProblemReportMessage.type)
  public readonly type = VtFlowProblemReportMessage.type.messageTypeUri
}
