import type { EventConfig } from '../utils/EventConfig'
import type { DynamicModule, Provider, Type } from '@nestjs/common'
import type { Plugin, VsAgent } from '@verana-labs/vs-agent-sdk'

export interface VsAgentNestPlugin {
  name: string
  /** Credo modules to merge into the agent at construction time */
  credoPlugin?: Plugin
  /** NestJS controllers to register in the admin module */
  controllers?: Type<any>[]
  /** NestJS providers to register in the admin module */
  providers?: Provider[]
  /** NestJS DynamicModules to import in the admin module */
  imports?: DynamicModule[]
  /** Event subscriptions to register after agent initialization */
  registerEvents?: (agent: VsAgent<any>, config: EventConfig) => void
}
