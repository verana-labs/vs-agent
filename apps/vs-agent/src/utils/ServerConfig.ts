import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'
import type { Express } from 'express'

import { DidCommFeatureQueryOptions } from '@credo-ts/didcomm'

import { TsLogger } from './logger'

export interface ServerConfig {
  port: number
  publicApiBaseUrl: string
  cors?: boolean
  app?: Express
  logger: TsLogger
  webhookUrl?: string
  discoveryOptions?: DidCommFeatureQueryOptions[]
  endpoints: string[]
  nestPlugins?: VsAgentNestPlugin[]
}

export interface DidWebServerConfig extends ServerConfig {
  baseUrl: string
}
