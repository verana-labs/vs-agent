import type { OpenId4VcIssuerRuntime } from './types'
import type {
  IndexerActivity,
  IndexerHandlerContext,
  IndexerHandlerRegistry,
} from '@verana-labs/vs-agent-sdk'

const REFRESH_MSGS = [
  'StartParticipantOP',
  'RenewParticipantOP',
  'SetParticipantOPToValidated',
  'SetParticipantEffectiveUntil',
  'RevokeParticipant',
  'SelfCreateParticipant',
  'CreateRootParticipant',
  'CreateNewCredentialSchema',
  'UpdateCredentialSchema',
  'ArchiveCredentialSchema',
] as const

/** Call after the default registry is built and overridden so the originals are preserved. */
export function registerCredentialConfigurationHandlers(
  registry: IndexerHandlerRegistry,
  getIssuerService: () => OpenId4VcIssuerRuntime | undefined,
): void {
  for (const msg of REFRESH_MSGS) {
    const original = registry.get(msg)
    registry.register({
      msg,
      handle: async (activity: IndexerActivity, ctx: IndexerHandlerContext) => {
        if (original) await original.handle(activity, ctx)
        try {
          await getIssuerService()?.refreshCredentialConfigurations()
        } catch (error) {
          ctx.agent.config.logger.error(
            `[OpenID4VC] credential configuration refresh failed for ${msg}`,
            error as Record<string, unknown>,
          )
        }
      },
    })
  }
}
