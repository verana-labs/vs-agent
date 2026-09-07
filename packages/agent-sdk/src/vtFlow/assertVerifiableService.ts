import type { BaseLogger } from '@credo-ts/core'
import type { VtFlowAssertVerifiableServiceHook } from '@verana-labs/credo-ts-didcomm-vt-flow'
import type { ResolverConfig, TrustResolution } from '@verana-labs/verre'

import { resolveDID, TrustResolutionOutcome } from '@verana-labs/verre'

export interface AssertVerifiableServiceOptions {
  verifiablePublicRegistries: NonNullable<ResolverConfig['verifiablePublicRegistries']>
  logger?: BaseLogger
  positiveTtlMs?: number
}

class VerdictCache implements NonNullable<ResolverConfig['cache']> {
  private map = new Map<string, { value: Promise<TrustResolution>; expiresAt: number }>()

  public constructor(private positiveTtlMs: number = 5 * 60_000) {}

  public get(key: string): Promise<TrustResolution> | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }

  public set(key: string, value: Promise<TrustResolution>): void {
    const entry = { value, expiresAt: Date.now() + this.positiveTtlMs }
    this.map.set(key, entry)
    void value.then(
      resolution => {
        if (this.map.get(key) !== entry) return
        if (resolution.verified && resolution.outcome === TrustResolutionOutcome.VERIFIED) return
        this.map.delete(key)
      },
      () => {
        if (this.map.get(key) === entry) this.map.delete(key)
      },
    )
  }

  public delete(key: string): void {
    this.map.delete(key)
  }

  public clear(): void {
    this.map.clear()
  }
}

// VS-CONN-VS gate: delegates trust resolution to `@verana-labs/verre` (`resolveDID`)
export function assertVerifiableService(
  options: AssertVerifiableServiceOptions,
): VtFlowAssertVerifiableServiceHook {
  const cache = new VerdictCache(options.positiveTtlMs)
  return async ({ agentContext, peerDid }) => {
    const logger = options.logger ?? agentContext.config.logger
    try {
      const source = cache.get(peerDid) ? 'cache' : 'fresh'
      const { verified, outcome, metadata } = await resolveDID(peerDid, {
        verifiablePublicRegistries: options.verifiablePublicRegistries,
        cache,
      })
      const trusted = verified && outcome === TrustResolutionOutcome.VERIFIED
      if (!trusted) {
        logger.warn(
          `[vt-flow] VS-CONN-VS rejected '${peerDid}': verified=${verified} outcome=${outcome} source=${source} ${metadata?.errorMessage ?? ''}`,
        )
      } else {
        logger.debug(`[vt-flow] VS-CONN-VS accepted '${peerDid}' source=${source}`)
      }
      return trusted
    } catch (error) {
      logger.warn(`[vt-flow] VS-CONN-VS resolution failed for '${peerDid}': ${(error as Error).message}`)
      return false
    }
  }
}
