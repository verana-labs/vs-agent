import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ReceivedUserProfile } from '@verana-labs/vs-agent-client'
import { Repository } from 'typeorm'

import { ConnectionStatus } from '../types'

import { ConnectionEntity } from './connection.entity'

@Injectable()
export class ConnectionsRepository {
  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly repository: Repository<ConnectionEntity>,
  ) {}

  public async create(connection: Partial<ConnectionEntity>): Promise<void> {
    await this.repository.createQueryBuilder().insert().values(connection).orIgnore().execute()
  }

  public async findById(id: string): Promise<ConnectionEntity | undefined> {
    return (await this.repository.findOne({ where: { id } })) ?? undefined
  }

  public async updateStatus(id: string, status: ConnectionStatus): Promise<boolean> {
    const result = await this.repository.update(id, { status })
    return (result.affected ?? 0) > 0
  }

  public async updateUserProfile(id: string, userProfile: ReceivedUserProfile): Promise<void> {
    await this.repository.update(id, { userProfile })
  }

  public async isCompleted(id: string, requireProfile: boolean): Promise<boolean> {
    const conn = await this.findById(id)
    if (!conn?.id) throw new Error(`No connection found with id: ${id}`)
    if (conn.status === ConnectionStatus.Completed) return false

    const completed = !requireProfile || conn.userProfile?.preferredLanguage != null
    if (completed) await this.updateStatus(conn.id, ConnectionStatus.Completed)
    return completed
  }
}
