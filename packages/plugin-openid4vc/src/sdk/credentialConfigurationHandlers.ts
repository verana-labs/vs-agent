import type { OpenId4VcIssuerRuntime, OpenId4VcPluginOptions } from '../types'
import type {
  IndexerActivity,
  IndexerHandlerContext,
  IndexerHandlerRegistry,
} from '@verana-labs/vs-agent-sdk'

import { ParticipantRole } from '@verana-labs/vs-agent-sdk'

const PARTICIPANT_MSGS = [
  'StartParticipantOP',
  'RenewParticipantOP',
  'SetParticipantOPToValidated',
  'SetParticipantEffectiveUntil',
  'RevokeParticipant',
  'SelfCreateParticipant',
  'CreateRootParticipant',
  'SlashParticipantTrustDeposit',
  'CancelParticipantOPLastRequest',
  'RepayParticipantSlashedTrustDeposit',
] as const

const CREDENTIAL_SCHEMA_MSGS = [
  'CreateNewCredentialSchema',
  'UpdateCredentialSchema',
  'ArchiveCredentialSchema',
] as const

/** Call after the default registry is built and overridden so the originals are preserved. */
export function registerCredentialConfigurationHandlers(
  registry: IndexerHandlerRegistry,
  options: Pick<OpenId4VcPluginOptions, 'credentialConfigurations'>,
  getIssuerService: () => OpenId4VcIssuerRuntime | undefined,
): void {
  const advertised = (credentialSchemaId: number): boolean =>
    options.credentialConfigurations.some(
      configuration => configuration.credentialSchemaId === credentialSchemaId,
    )

  const wrap = (
    msg: string,
    concerns: (activity: IndexerActivity, ctx: IndexerHandlerContext) => Promise<boolean>,
    updatedCredentialSchemaId?: (activity: IndexerActivity) => number | undefined,
  ): void => {
    const original = registry.get(msg)
    registry.register({
      msg,
      handle: async (activity: IndexerActivity, ctx: IndexerHandlerContext) => {
        if (original) await original.handle(activity, ctx)
        try {
          if (!(await concerns(activity, ctx))) return
          await getIssuerService()?.refreshCredentialConfigurations(updatedCredentialSchemaId?.(activity))
        } catch (error) {
          ctx.agent.config.logger.error(
            `[OpenID4VC] credential configuration refresh failed for ${msg}`,
            error as Record<string, unknown>,
          )
        }
      },
    })
  }

  for (const msg of PARTICIPANT_MSGS) {
    wrap(msg, async (activity, ctx) => {
      const { agent } = ctx
      if (!agent.did) return false
      const participant = await agent.indexer.getParticipant(String(activity.entity_id))
      if (participant.did === agent.did && participant.role === ParticipantRole.Issuer) return true
      return advertised(Number(participant.schema_id))
    })
  }

  for (const msg of CREDENTIAL_SCHEMA_MSGS) {
    wrap(
      msg,
      async activity => advertised(Number(activity.entity_id)),
      activity => (msg === 'UpdateCredentialSchema' ? Number(activity.entity_id) : undefined),
    )
  }
}
