import type { VeranaIndexerService, VeranaSyncState } from '../blockchain'

import { VsAgent } from '../agent'

export interface VtFlowClaimsConfig {
  organization?: Record<string, unknown>
  service?: Record<string, unknown>
  persona?: Record<string, unknown>
}

export type EcsSchemaKind = keyof VtFlowClaimsConfig

export interface VtFlowSetupOptions {
  claims: VtFlowClaimsConfig
  indexer: VeranaIndexerService
}

export interface ValidateFlowOptions {
  credentialSchemaCredentialId: string
}

export interface IndexerHandlerContext {
  agent: VsAgent
  block_height: number
  operatorAddress: string
  state: VeranaSyncState
}
