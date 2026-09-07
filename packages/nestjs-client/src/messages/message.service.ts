import { MessageState } from '@2060.io/credo-ts-didcomm-receipts'
import { JsonTransformer } from '@credo-ts/core'
import { DidCommCredentialState } from '@credo-ts/didcomm'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ApiClient, ApiVersion } from '@verana-labs/vs-agent-client'
import {
  CredentialReceptionMessage,
  MessageReceived,
  ProfileMessage,
  ReceiptsMessage,
} from '@verana-labs/vs-agent-model'

import { ConnectionsEventService, ConnectionsRepository } from '../connections'
import { CredentialService } from '../credentials'
import { EventHandler } from '../interfaces'
import { MessageEventOptions } from '../types'

@Injectable()
export class MessageEventService {
  private readonly logger = new Logger(MessageEventService.name)
  private readonly url: string
  private readonly version: ApiVersion
  private readonly apiClient: ApiClient

  constructor(
    @Inject('GLOBAL_MODULE_OPTIONS') private options: MessageEventOptions,
    @Optional() @Inject('MESSAGE_EVENT') private eventHandler?: EventHandler,
    @Optional() @Inject(CredentialService) private credentialService?: CredentialService,
    @Optional() @Inject(ConnectionsRepository) private connectionRepository?: ConnectionsRepository,
    @Optional() @Inject(ConnectionsEventService) private connectionsEventService?: ConnectionsEventService,
  ) {
    if (!options.url) throw new Error(`For this module to be used the value url must be added`)
    this.url = options.url
    this.version = options.version ?? ApiVersion.V1

    if (!credentialService)
      this.logger.warn(
        `To handle credential events and their revocation, make sure to initialize the CredentialService.`,
      )

    this.apiClient = new ApiClient(this.url, this.version)

    this.logger.debug(`Initialized with url: ${this.url}, version: ${this.version}`)
  }

  async received(event: MessageReceived): Promise<void> {
    const message = event.message
    const body = new ReceiptsMessage({
      connectionId: message.connectionId,
      receipts: [
        {
          messageId: message.id,
          state: MessageState.Viewed,
          timestamp: new Date(),
        },
      ],
    })
    this.logger.debug(`messageReceived: sent receipts: ${JSON.stringify(body)}`)

    await this.apiClient.messages.send(body)

    if (this.eventHandler) {
      if (message.type === CredentialReceptionMessage.type) {
        try {
          const msg = JsonTransformer.fromJSON(message, CredentialReceptionMessage)
          const isCredentialDone = msg.state === DidCommCredentialState.Done
          if (this.credentialService) {
            if (!msg.threadId) throw new Error('threadId is required for credential')
            if (isCredentialDone) await this.credentialService.handleAcceptance(msg.threadId)
            else await this.credentialService.handleRejection(msg.threadId)
          }
        } catch (error) {
          this.logger.error(`Cannot create the registry: ${error}`)
        }
      } else if (
        this.connectionRepository &&
        this.connectionsEventService &&
        message.type === ProfileMessage.type
      ) {
        const msg = JsonTransformer.fromJSON(message, ProfileMessage)
        await this.connectionRepository.updateUserProfile(msg.connectionId, { ...msg })
        await this.connectionsEventService?.handleNewConnection(msg.connectionId)
      }

      await this.eventHandler.inputMessage(message)
    }
  }
}
