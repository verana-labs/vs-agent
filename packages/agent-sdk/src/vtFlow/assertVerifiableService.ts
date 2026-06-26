import type { BaseLogger } from '@credo-ts/core'
import type { VtFlowAssertVerifiableServiceHook } from '@verana-labs/credo-ts-didcomm-vt-flow'
import type { ResolverConfig } from '@verana-labs/verre'

export interface AssertVerifiableServiceDeps {
  verifiablePublicRegistries: NonNullable<ResolverConfig['verifiablePublicRegistries']>
  logger?: BaseLogger
}

// TODO: Remove this workaround after migrating to ESM
const importVerre = new Function('s', 'return import(s)') as (
  s: string,
) => Promise<typeof import('@verana-labs/verre')>

/**
 * VS-CONN-VS gate: delegates trust resolution to `@verana-labs/verre` (`resolveDID`), which verifies
 * the peer's VTC signatures, schema bindings, digestSRI, issuer permissions and recurses to the
 * Ecosystem trust root. We only map the result to a boolean (fail-closed on error, TR-8).
 */
export function assertVerifiableService(
  deps: AssertVerifiableServiceDeps,
): VtFlowAssertVerifiableServiceHook {
  let verre: Promise<typeof import('@verana-labs/verre')> | undefined
  let cache: ResolverConfig['cache']
  return async ({ agentContext, peerDid }) => {
    const logger = deps.logger ?? agentContext.config.logger
    try {
      const { resolveDID, InMemoryCache } = await (verre ??= importVerre('@verana-labs/verre'))
      cache ??= new InMemoryCache()
      const { verified, outcome, metadata } = await resolveDID(peerDid, {
        verifiablePublicRegistries: deps.verifiablePublicRegistries,
        cache,
      })
      if (!verified) {
        logger.warn(`[vt-flow] VS-CONN-VS rejected '${peerDid}': ${outcome} ${metadata?.errorMessage ?? ''}`)
      }
      return verified
    } catch (error) {
      logger.warn(`[vt-flow] VS-CONN-VS resolution failed for '${peerDid}': ${(error as Error).message}`)
      return false
    }
  }
}
