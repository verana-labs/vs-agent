import type { DynamicModule, Provider, Type } from '@nestjs/common'
import type { BaseAgentModules, Plugin, VsAgent } from '@verana-labs/vs-agent-sdk'
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

export interface VsAgentNestPlugin {
  name: string
  credoPlugin?: Plugin
  controllers?: Type<any>[]
  providers?: Provider[]
  imports?: DynamicModule[]
  registerEvents?: (agent: VsAgent<BaseAgentModules>, config: ServerConfig) => void
}
