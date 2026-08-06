import { MrtdCapabilities } from '@2060.io/credo-ts-didcomm-mrtd'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ConnectionStateUpdated, ExtendedDidExchangeState } from '@verana-labs/vs-agent-model'

import { EventHandler } from '../interfaces'
import { ConnectionEventOptions } from '../types'

import { ConnectionEntity } from './connection.entity'
import { ConnectionsRepository } from './connection.repository'

@Injectable()
export class ConnectionsEventService {
  private readonly logger = new Logger(ConnectionsEventService.name)
  private readonly messageEvent: boolean

  constructor(
    @Inject('GLOBAL_MODULE_OPTIONS') private options: ConnectionEventOptions,
    @Inject(ConnectionsRepository) private readonly repository: ConnectionsRepository,
    @Optional() @Inject('CONNECTIONS_EVENT') private eventHandler?: EventHandler,
  ) {
    this.messageEvent = options.useMessages ?? false
  }

  async update(event: ConnectionStateUpdated): Promise<any> {
    switch (event.state) {
      case ExtendedDidExchangeState.Updated:
        if (event.metadata?.[MrtdCapabilities.EMrtdReadSupport])
          await this.repository.updateMetadata(event.connectionId, event.metadata)
        await this.handleNewConnection(event.connectionId)
        break
      case ExtendedDidExchangeState.Completed:
        const newConnection = new ConnectionEntity()
        newConnection.id = event.connectionId
        newConnection.createdTs = event.timestamp
        newConnection.status = ExtendedDidExchangeState.Start
        newConnection.metadata = event.metadata
        await this.repository.create(newConnection)
        break
      case ExtendedDidExchangeState.Terminated:
        await this.repository.updateStatus(event.connectionId, event.state)

        if (this.eventHandler) {
          await this.eventHandler.closeConnection(event.connectionId)
        }
        break
      default:
        break
    }

    return null
  }

  /**
   * Handles a new connection by verifying its completion status.
   *
   * If the connection is considered completed, it triggers the event handler
   * and logs the connection initiation.
   *
   * @param connectionId The unique identifier of the connection.
   * @returns A promise that resolves when the connection is processed.
   */
  async handleNewConnection(connectionId: string): Promise<void> {
    if (!this.eventHandler) return

    const isCompleted = await this.repository.isCompleted(connectionId, !!this.messageEvent)
    if (isCompleted) {
      this.logger.log(`A new connection has been completed with connection id: ${connectionId}`)
      await this.eventHandler.newConnection(connectionId)
    }
  }
}
