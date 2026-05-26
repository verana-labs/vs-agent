import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'
import type { Express } from 'express'

import { TsLogger } from './logger'

export interface ServerConfig {
  port: number
  publicApiBaseUrl: string
  cors?: boolean
  app?: Express
  logger: TsLogger
  endpoints: string[]
  nestPlugins?: VsAgentNestPlugin[]
}

export interface DidWebServerConfig extends ServerConfig {
  baseUrl: string
}
