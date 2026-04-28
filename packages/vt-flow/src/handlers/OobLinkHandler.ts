import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { OobLinkMessage } from '../messages'

/** Applicant-side inbound handler for `oob-link`; delegates to `VtFlowService.processReceiveOobLink`. */
export class OobLinkHandler implements DidCommMessageHandler {
  public supportedMessages = [OobLinkMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<OobLinkHandler>) {
    await this.vtFlowService.processReceiveOobLink(messageContext)
    return undefined
  }
}
