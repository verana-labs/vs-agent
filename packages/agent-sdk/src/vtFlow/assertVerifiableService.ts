import type { BaseLogger } from '@credo-ts/core'
import type { VtFlowAssertVerifiableServiceHook } from '@verana-labs/credo-ts-didcomm-vt-flow'
import type { ResolverConfig } from '@verana-labs/verre'

import { resolveDID, InMemoryCache } from '@verana-labs/verre'

export interface AssertVerifiableServiceOptions {
  verifiablePublicRegistries: NonNullable<ResolverConfig['verifiablePublicRegistries']>
  logger?: BaseLogger
}

// VS-CONN-VS gate: delegates trust resolution to `@verana-labs/verre` (`resolveDID`)
export function assertVerifiableService(
  options: AssertVerifiableServiceOptions,
): VtFlowAssertVerifiableServiceHook {
  let cache: ResolverConfig['cache']
  return async ({ agentContext, peerDid }) => {
    const logger = options.logger ?? agentContext.config.logger
    try {
      cache ??= new InMemoryCache()
      const { verified, outcome, metadata } = await resolveDID(peerDid, {
        verifiablePublicRegistries: options.verifiablePublicRegistries,
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
