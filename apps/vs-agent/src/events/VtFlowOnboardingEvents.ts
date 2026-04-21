import type { VtFlowStateChangedEvent } from '@verana-labs/credo-ts-didcomm-vt-flow'
import type { VsAgent, VsAgentPluginConfig } from '@verana-labs/vs-agent-sdk'

import { JsonTransformer, W3cCredential, W3cJsonLdVerifiableCredential } from '@credo-ts/core'
import { DidCommCredentialExchangeRepository } from '@credo-ts/didcomm'
import { VtFlowEventTypes, VtFlowRepository, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { TrustService } from '../controllers/admin/verifiable/TrustService'

/**
 * On vt-flow COMPLETED, link the issued credential into the agent's DID
 * Document via TrustService.createVtc. Replaces the manual
 * POST /v1/vt/linked-credentials step.
 */
export function vtFlowOnboardingEvents(
  agent: VsAgent,
  config: VsAgentPluginConfig,
  trustService: TrustService,
): void {
  const logger = config.logger

  agent.events.on<VtFlowStateChangedEvent>(VtFlowEventTypes.VtFlowStateChanged, async ({ payload }) => {
    if (payload.state !== VtFlowState.Completed) return
    if (payload.previousState === VtFlowState.Completed) return

    try {
      const vtFlowRepository = agent.context.dependencyManager.resolve(VtFlowRepository)
      const record = await vtFlowRepository.findById(agent.context, payload.vtFlowRecordId)
      if (!record || !record.credentialExchangeRecordId) {
        return
      }

      const schemaBaseId = record.getTag('schemaBaseId') as string | undefined
      if (!schemaBaseId) {
        logger.warn(`[vt-flow] COMPLETED vt-flow ${record.id} has no schemaBaseId tag; skipping auto-link`)
        return
      }

      const credentialRepository = agent.context.dependencyManager.resolve(
        DidCommCredentialExchangeRepository,
      )
      const credentialExchangeRecord = await credentialRepository.findById(
        agent.context,
        record.credentialExchangeRecordId,
      )
      if (!credentialExchangeRecord) {
        logger.warn(`[vt-flow] COMPLETED vt-flow ${record.id} references unknown credential exchange`)
        return
      }

      const credentialRecord = credentialExchangeRecord.credentials?.[0]
      if (!credentialRecord) {
        logger.warn(`[vt-flow] COMPLETED vt-flow ${record.id} has no credentials attached`)
        return
      }

      const w3cRecord = await agent.w3cCredentials.getById(credentialRecord.credentialRecordId)
      const jsonLdCredential = JsonTransformer.toJSON(w3cRecord.firstCredential) as unknown as W3cCredential
      const vc = JsonTransformer.fromJSON(jsonLdCredential, W3cJsonLdVerifiableCredential)

      logger.info(
        `[vt-flow] COMPLETED ${record.id}; auto-linking credential as VP (schemaBaseId=${schemaBaseId})`,
      )
      await trustService.createVtc(schemaBaseId, vc)
      logger.info(`[vt-flow] Auto-link succeeded for vt-flow ${record.id}`)
    } catch (error) {
      logger.error(
        `[vt-flow] Auto-link on COMPLETED threw: ${(error as Error).message}`,
        error as Record<string, unknown>,
      )
    }
  })
}
