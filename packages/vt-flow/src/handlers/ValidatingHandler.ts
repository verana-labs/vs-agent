import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { ValidatingMessage } from '../messages'

/** Applicant-side inbound handler for `validating`; delegates to `VtFlowService.processReceiveValidating`. */
export class ValidatingHandler implements DidCommMessageHandler {
  public supportedMessages = [ValidatingMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<ValidatingHandler>) {
    await this.vtFlowService.processReceiveValidating(messageContext)
    return undefined
  }
}
