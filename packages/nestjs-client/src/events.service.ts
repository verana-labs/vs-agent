import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { EventDispatcher, EventEnvelope, UnknownEventEnvelope } from '@verana-labs/vs-agent-client'

import { ConnectionsService } from './connections'
import { CredentialService } from './credentials'
import { EventHandler } from './interfaces'
import { EVENT_HANDLER } from './tokens'

const SEEN_LIMIT = 4096

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name)
  private readonly dispatcher = new EventDispatcher()
  private readonly seen = new Set<string>()

  constructor(
    @Inject(EVENT_HANDLER) private readonly eventHandler: EventHandler,
    @Optional() @Inject(ConnectionsService) connections?: ConnectionsService,
    @Optional() @Inject(CredentialService) credentials?: CredentialService,
  ) {
    if (connections) {
      this.dispatcher
        .on('didcomm.connections.state-updated', (data, envelope) =>
          connections.handleStateUpdated(data, envelope.timestamp),
        )
        .on('didcomm.user-profile.profile-received', data => connections.handleProfileReceived(data))
    }
    if (credentials) {
      this.dispatcher.on('didcomm.credential-exchanges.state-updated', async data => {
        if (data.role !== 'issuer') return
        if (data.state === 'done') await credentials.handleAcceptance(data.credentialExchangeId)
        else if (data.state === 'declined' || data.state === 'abandoned') {
          await credentials.handleRejection(data.credentialExchangeId)
        }
      })
    }
  }

  public async receive(envelope: EventEnvelope | UnknownEventEnvelope): Promise<void> {
    if (this.seen.has(envelope.id)) return
    this.seen.add(envelope.id)
    if (this.seen.size > SEEN_LIMIT) {
      const [oldest] = this.seen
      this.seen.delete(oldest)
    }

    try {
      await this.dispatcher.dispatch(envelope)
    } catch (error) {
      this.logger.error(`Internal handler failed for event ${envelope.type} (${envelope.id}): ${error}`)
    }
    await this.eventHandler.onEvent(envelope)
  }
}
