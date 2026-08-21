import type { IndexerSyncStatus } from '@verana-labs/vs-agent-sdk'

export const BOOTSTRAP_STATE = 'BOOTSTRAP_STATE'

export type BootstrapStep = 'vtjsc-service-id-migration' | 'self-trust-registry' | 'indexer-subscription'

export type BootstrapStepState = 'pending' | 'completed' | 'skipped' | 'failed'

export type EcsBootstrapOutcome = 'pending' | 'completed' | 'failed'

export interface EcsBootstrapRecord {
  mode: string
  outcome: EcsBootstrapOutcome
  reason?: string
}

export interface ReadinessResult {
  ready: boolean
  message?: string
}

export class BootstrapState {
  private readonly steps = new Map<BootstrapStep, BootstrapStepState>()
  private readonly failures = new Map<BootstrapStep, string>()
  private indexerSyncStatus?: () => IndexerSyncStatus
  private ecsBootstrap?: EcsBootstrapRecord

  public require(step: BootstrapStep): void {
    this.steps.set(step, 'pending')
  }

  public complete(step: BootstrapStep): void {
    this.steps.set(step, 'completed')
    this.failures.delete(step)
  }

  public skip(step: BootstrapStep): void {
    this.steps.set(step, 'skipped')
    this.failures.delete(step)
  }

  public fail(step: BootstrapStep, reason: string): void {
    this.steps.set(step, 'failed')
    this.failures.set(step, reason)
  }

  public watchIndexer(probe: () => IndexerSyncStatus): void {
    this.indexerSyncStatus = probe
  }

  public recordEcsBootstrap(mode: string, outcome: EcsBootstrapOutcome, reason?: string): void {
    this.ecsBootstrap = { mode, outcome, reason }
  }

  public get stepStates(): Record<string, BootstrapStepState> {
    return Object.fromEntries(this.steps)
  }

  public get ecsBootstrapRecord(): EcsBootstrapRecord | undefined {
    return this.ecsBootstrap
  }

  public get readiness(): ReadinessResult {
    for (const [step, state] of this.steps) {
      if (state === 'pending') return { ready: false, message: `bootstrap step '${step}' has not completed` }
      if (state === 'failed') return { ready: false, message: `bootstrap step '${step}' failed` }
    }

    switch (this.indexerSyncStatus?.()) {
      case 'never-synced':
        return { ready: false, message: 'the initial indexer catch-up has not completed' }
      case 'catching-up':
        return { ready: false, message: 'the agent is catching up with the indexer' }
      default:
        return { ready: true }
    }
  }
}
