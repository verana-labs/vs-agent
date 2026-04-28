import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { ValidationRequestMessage } from '../messages'

/** Validator-side inbound handler for `validation-request`; delegates to `VtFlowService.processReceiveValidationRequest`. */
export class ValidationRequestHandler implements DidCommMessageHandler {
  public supportedMessages = [ValidationRequestMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<ValidationRequestHandler>) {
    await this.vtFlowService.processReceiveValidationRequest(messageContext)
    return undefined
  }
}
