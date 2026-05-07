import { VsAgent } from '../agent'
import { IndexerEventHandler, IndexerHandlerRegistry } from '../blockchain/handlers'

import { VtFlowClaimsConfig, VtFlowSetupOptions } from './types'

export class VtFlowOrchestrator {
  private readonly claims: VtFlowClaimsConfig

  public constructor(
    private readonly agent: VsAgent,
    options: VtFlowSetupOptions,
  ) {
    this.claims = options.claims
  }
}

function buildVtFlowEventHandlers(_orchestrator: VtFlowOrchestrator): IndexerEventHandler[] {
  return []
}

export function setupVtFlowOrchestrator(
  agent: VsAgent,
  registry: IndexerHandlerRegistry,
  options: VtFlowSetupOptions,
): VtFlowOrchestrator {
  const orchestrator = new VtFlowOrchestrator(agent, options)
  buildVtFlowEventHandlers(orchestrator).forEach(handler => registry.register(handler))
  return orchestrator
}
