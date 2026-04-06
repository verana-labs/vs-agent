import type { EventConfig } from '../utils/EventConfig'
import type { DynamicModule, Provider, Type } from '@nestjs/common'
import type { DidCommAgentModules, Plugin, VsAgent } from '@verana-labs/vs-agent-sdk'

/**
 * Represents a plugin that extends the VsAgent within a NestJS application.
 * It allows integrating Credo modules, registering NestJS components
 * (controllers, providers, imports), and hooking into the agent lifecycle
 * to attach custom event listeners after initialization.
 */
export interface VsAgentNestPlugin {
  name: string
  credoPlugin?: Plugin
  controllers?: Type<any>[]
  providers?: Provider[]
  imports?: DynamicModule[]
  registerEvents?: (agent: VsAgent<DidCommAgentModules>, config: EventConfig) => void
}
