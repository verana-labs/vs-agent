import type { BaseAgentModules, VsAgent } from './agent/VsAgent'

import { BaseLogger } from '@credo-ts/core'

export type Plugin = { modules: Record<string, unknown> }

export interface DidcommModule {
  module: string
  prefixes: string[]
}

export interface VsAgentNestPlugin {
  name: string
  credoPlugin?: Plugin
  controllers?: (new (...args: any[]) => any)[]
  providers?: any[]
  didcommModules?: DidcommModule[]
  imports?: any[]
  registerEvents?: (agent: VsAgent<BaseAgentModules>, logger: BaseLogger) => void
}

export const ISSUER_PARTICIPANT_TYPE = 1
export const VERIFIER_PARTICIPANT_TYPE = 2
export const ISSUER_GRANTOR_PARTICIPANT_TYPE = 3
export const VERIFIER_GRANTOR_PARTICIPANT_TYPE = 4
export const HOLDER_PARTICIPANT_TYPE = 6
