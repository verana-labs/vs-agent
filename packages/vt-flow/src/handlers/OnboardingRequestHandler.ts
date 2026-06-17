import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { OnboardingRequestMessage } from '../messages'

/** Validator-side inbound handler for `onboarding-request`; delegates to `VtFlowService.processReceiveOnboardingRequest`. */
export class OnboardingRequestHandler implements DidCommMessageHandler {
  public supportedMessages = [OnboardingRequestMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<OnboardingRequestHandler>) {
    await this.vtFlowService.processReceiveOnboardingRequest(messageContext)
    return undefined
  }
}
