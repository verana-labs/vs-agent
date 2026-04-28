import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { IssuanceRequestMessage } from '../messages'

/** Validator-side inbound handler for `issuance-request`; delegates to `VtFlowService.processReceiveIssuanceRequest`. */
export class IssuanceRequestHandler implements DidCommMessageHandler {
  public supportedMessages = [IssuanceRequestMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<IssuanceRequestHandler>) {
    await this.vtFlowService.processReceiveIssuanceRequest(messageContext)
    return undefined
  }
}
