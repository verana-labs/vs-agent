import { ReceivedUserProfile } from '@verana-labs/vs-agent-client'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

import { ConnectionStatus } from '../types'

@Entity('connections')
export class ConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id?: string

  @Column({ type: 'enum', enum: ConnectionStatus, default: ConnectionStatus.Start })
  status?: ConnectionStatus

  @Column('jsonb', { nullable: true })
  userProfile?: ReceivedUserProfile

  @CreateDateColumn()
  createdTs?: Date

  @UpdateDateColumn()
  updatedTs?: Date
}
