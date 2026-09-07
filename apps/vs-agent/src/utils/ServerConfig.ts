import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'
import type { Express } from 'express'

import type { BootstrapState } from '../common'

import { TsLogger } from './logger'

export interface ServerConfig {
  port: number
  publicApiBaseUrl: string
  cors?: boolean
  app?: Express
  logger: TsLogger
  endpoints: string[]
  nestPlugins?: VsAgentNestPlugin[]
  bootstrapState?: BootstrapState
}

export interface DidWebServerConfig extends ServerConfig {
  baseUrl: string
}
