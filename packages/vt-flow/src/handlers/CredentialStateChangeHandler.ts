import type { VtFlowService } from '../services'
import type { DidCommMessageHandler, DidCommMessageHandlerInboundMessage } from '@credo-ts/didcomm'

import { CredentialStateChangeMessage } from '../messages'

export class CredentialStateChangeHandler implements DidCommMessageHandler {
  public supportedMessages = [CredentialStateChangeMessage]

  public constructor(private readonly vtFlowService: VtFlowService) {}

  public async handle(messageContext: DidCommMessageHandlerInboundMessage<CredentialStateChangeHandler>) {
    await this.vtFlowService.processReceiveCredentialStateChange(messageContext)
    return undefined
  }
}
