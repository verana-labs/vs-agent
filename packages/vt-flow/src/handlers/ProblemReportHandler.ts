import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { VtFlowProblemReportMessage } from '../messages'

/** Inbound handler for the adopted `problem-report`; both roles apply the Error Codes table. */
export class ProblemReportHandler implements DidCommMessageHandler {
  public supportedMessages = [VtFlowProblemReportMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<ProblemReportHandler>) {
    await this.vtFlowService.processReceiveProblemReport(messageContext)
    return undefined
  }
}
