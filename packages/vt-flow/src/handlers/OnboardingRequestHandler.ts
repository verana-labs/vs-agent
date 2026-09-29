import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { DidCommOutboundMessageContext } from '@credo-ts/didcomm'

import { VtFlowError, buildVtFlowProblemReport } from '../errors'
import { OnboardingRequestMessage } from '../messages'

/** Validator-side inbound handler for `onboarding-request`; delegates to `VtFlowService.processReceiveOnboardingRequest`. */
export class OnboardingRequestHandler implements DidCommMessageHandler {
  public supportedMessages = [OnboardingRequestMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<OnboardingRequestHandler>) {
    try {
      await this.vtFlowService.processReceiveOnboardingRequest(messageContext)
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
