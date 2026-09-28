import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConnectionStateUpdatedData, ProfileReceivedData } from '@verana-labs/vs-agent-client'

import { EventHandler } from '../interfaces'
import { EVENT_HANDLER, EVENTS_MODULE_OPTIONS } from '../tokens'
import { ConnectionStatus, EventsModuleOptions } from '../types'

import { ConnectionsRepository } from './connection.repository'

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name)
  private readonly requireProfile: boolean

  constructor(
    @Inject(EVENTS_MODULE_OPTIONS) options: EventsModuleOptions,
    @Inject(ConnectionsRepository) private readonly repository: ConnectionsRepository,
    @Inject(EVENT_HANDLER) private readonly eventHandler: EventHandler,
  ) {
    const connections = options.modules?.connections
    this.requireProfile = typeof connections === 'object' ? (connections.requireProfile ?? true) : true
  }

  public async handleStateUpdated(data: ConnectionStateUpdatedData, timestamp: string): Promise<void> {
    if (data.state === 'completed' && data.previousState !== 'completed') {
      await this.repository.create({
        id: data.id,
        status: ConnectionStatus.Start,
        createdTs: new Date(timestamp),
      })
      await this.handleNewConnection(data.id)
    } else if (data.state === 'abandoned') {
      const existed = await this.repository.updateStatus(data.id, ConnectionStatus.Terminated)
      if (existed) await this.eventHandler.closeConnection(data.id)
    }
  }

  public async handleProfileReceived(data: ProfileReceivedData): Promise<void> {
    await this.repository.create({ id: data.connectionId, status: ConnectionStatus.Start })
    await this.repository.updateUserProfile(data.connectionId, data.profile)
    await this.handleNewConnection(data.connectionId)
  }

  public async handleNewConnection(connectionId: string): Promise<void> {
    if (await this.repository.isCompleted(connectionId, this.requireProfile)) {
      this.logger.log(`A new connection has been completed with connection id: ${connectionId}`)
      await this.eventHandler.newConnection(connectionId)
    }
  }
}
