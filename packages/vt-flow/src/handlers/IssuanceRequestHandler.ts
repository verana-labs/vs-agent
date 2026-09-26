import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { DidCommOutboundMessageContext } from '@credo-ts/didcomm'

import { VtFlowError, buildVtFlowProblemReport } from '../errors'
import { IssuanceRequestMessage } from '../messages'

/** Validator-side inbound handler for `issuance-request`; delegates to `VtFlowService.processReceiveIssuanceRequest`. */
export class IssuanceRequestHandler implements DidCommMessageHandler {
  public supportedMessages = [IssuanceRequestMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<IssuanceRequestHandler>) {
    try {
      await this.vtFlowService.processReceiveIssuanceRequest(messageContext)
      return undefined
    } catch (error) {
      if (!(error instanceof VtFlowError)) throw error
      return new DidCommOutboundMessageContext(
        buildVtFlowProblemReport({ code: error.code, threadId: messageContext.message.threadId }),
        { agentContext: messageContext.agentContext, connection: messageContext.assertReadyConnection() },
      )
    }
  }
}
