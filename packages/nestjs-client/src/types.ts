import { Type } from '@nestjs/common'

import { EventHandler } from './interfaces'

export interface StatOptions {
  host?: string
  port?: number
  queue?: string
  username?: string
  password?: string
  reconnectLimit?: number
  threads?: number
  delay?: number
}

export interface EventsModuleOptions {
  url: string
  token?: string
  webhookApiKey?: string
  eventHandler: Type<EventHandler>
  modules?: {
    connections?: boolean | { requireProfile?: boolean }
    credentials?: boolean
    stats?: boolean
  }
  statOptions?: StatOptions
}

export enum ConnectionStatus {
  Start = 'start',
  Completed = 'completed',
  Terminated = 'terminated',
}

export enum CredentialStatus {
  OFFERED = 'offered',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  REVOKED = 'revoked',
}
