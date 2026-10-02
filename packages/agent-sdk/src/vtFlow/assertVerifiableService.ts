import type { BaseLogger } from '@credo-ts/core'
import type { VtFlowAssertVerifiableServiceHook } from '@verana-labs/credo-ts-didcomm-vt-flow'
import type { ResolverConfig, TrustResolution } from '@verana-labs/verre'

import { resolveDID, TrustResolutionOutcome } from '@verana-labs/verre'

export { TrustResolutionOutcome }

export type VerifiablePublicRegistries = NonNullable<ResolverConfig['verifiablePublicRegistries']>

export interface DidTrustResolverOptions {
  verifiablePublicRegistries: VerifiablePublicRegistries
  positiveTtlMs?: number
}

export interface AssertVerifiableServiceOptions extends DidTrustResolverOptions {
  logger?: BaseLogger
}

/** What the Verifiable Trust resolution of a DID answers, as [TR] defines it. */
export interface DidTrustResolution {
  /** `verified` with the outcome `VERIFIED`: a production registry vouches for the DID. */
  trusted: boolean
  verified: boolean
  outcome: TrustResolutionOutcome
  /** Whether the verdict came from the positive-verdict cache of the resolver. */
  source: 'cache' | 'fresh'
  errorMessage?: string
}

export type DidTrustResolver = (did: string) => Promise<DidTrustResolution>

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

/**
 * The Verifiable Trust resolution of a DID through `@verana-labs/verre` (`resolveDID`), the one
 * resolution the agent applies to every peer: a DIDComm connection ([VS-CONN-VS]) and the issuer
 * of a presented credential ([VSA-VTI-FLOW-VERIFY-OID] step 7) alike. A positive verdict is cached
 * for `positiveTtlMs`; a negative one is not.
 */
export function createDidTrustResolver(options: DidTrustResolverOptions): DidTrustResolver {
  const cache = new VerdictCache(options.positiveTtlMs)
  return async did => {
    const source = cache.get(did) ? 'cache' : 'fresh'
    const { verified, outcome, metadata } = await resolveDID(did, {
      verifiablePublicRegistries: options.verifiablePublicRegistries,
      cache,
    })
    return {
      trusted: verified && outcome === TrustResolutionOutcome.VERIFIED,
      verified,
      outcome,
      source,
      ...(metadata?.errorMessage ? { errorMessage: metadata.errorMessage } : {}),
    }
  }
}

// VS-CONN-VS gate: delegates trust resolution to `@verana-labs/verre` (`resolveDID`)
export function assertVerifiableService(
  options: AssertVerifiableServiceOptions,
): VtFlowAssertVerifiableServiceHook {
  const resolve = createDidTrustResolver(options)
  return async ({ agentContext, peerDid }) => {
    const logger = options.logger ?? agentContext.config.logger
    try {
      const { trusted, verified, outcome, source, errorMessage } = await resolve(peerDid)
      if (!trusted) {
        logger.warn(
          `[vt-flow] VS-CONN-VS rejected '${peerDid}': verified=${verified} outcome=${outcome} source=${source} ${errorMessage ?? ''}`,
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
