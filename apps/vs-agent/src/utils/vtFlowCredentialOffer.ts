import type {
  VtFlowBuildCredentialOfferHook,
  VtFlowModuleConfigOptions,
} from '@verana-labs/credo-ts-didcomm-vt-flow'

import { DidRepository } from '@credo-ts/core'
import { DidCommModuleConfig } from '@credo-ts/didcomm'

/**
 * Per-transition auto-chain flags. Default on; each can be turned off via
 * env var in deployments where on-chain gates run between transitions.
 */
export const vtFlowOptions = (): VtFlowModuleConfigOptions => ({
  autoAcceptValidationRequest: process.env.VTFLOW_AUTO_ACCEPT_VR !== 'false',
  autoAcceptIssuanceRequest: process.env.VTFLOW_AUTO_ACCEPT_IR !== 'false',
  autoMarkValidated: process.env.VTFLOW_AUTO_MARK_VALIDATED !== 'false',
  autoOfferCredential: process.env.VTFLOW_AUTO_OFFER_CREDENTIAL !== 'false',
  autoAcceptCredentialOffer: process.env.VTFLOW_AUTO_ACCEPT_OFFER !== 'false',
  autoIssueCredentialOnRequest: process.env.VTFLOW_AUTO_ISSUE !== 'false',
  buildCredentialOffer,
})

/**
 * Validator-side credential builder. Picks the agent's own did:webvh (or
 * did:web fallback) whose domain matches the current DIDComm endpoint —
 * stale records from rotated URLs are skipped — and builds a signed W3C
 * JSON-LD credential from the applicant's claims.
 */
export const buildCredentialOffer: VtFlowBuildCredentialOfferHook = async ({ agentContext, record }) => {
  const didRepository = agentContext.dependencyManager.resolve(DidRepository)
  const didcommConfig = agentContext.dependencyManager.resolve(DidCommModuleConfig)

  const currentHosts = (didcommConfig.endpoints ?? [])
    .map(
      e =>
        e
          .replace(/^wss?:\/\//, '')
          .replace(/^https?:\/\//, '')
          .split('/')[0],
    )
    .filter(Boolean)
  const matchesCurrentHost = (did: string): boolean =>
    currentHosts.length === 0 || currentHosts.some(h => did.includes(h))

  const webvhDids = (await didRepository.getCreatedDids(agentContext, { method: 'webvh' })).filter(r =>
    matchesCurrentHost(r.did),
  )
  const webDids =
    webvhDids.length > 0
      ? []
      : (await didRepository.getCreatedDids(agentContext, { method: 'web' })).filter(r =>
          matchesCurrentHost(r.did),
        )
  const issuerDid = webvhDids[0]?.did ?? webDids[0]?.did
  if (!issuerDid) {
    agentContext.config.logger.warn(
      '[vt-flow] buildCredentialOffer: no publishable DID on this agent; skipping auto-offer',
    )
    return null
  }
  agentContext.config.logger.debug(
    `[vt-flow] buildCredentialOffer: issuing as ${issuerDid} for session ${record.sessionUuid}`,
  )

  // Drop undefined id to keep JSON-LD safe mode happy.
  const subject: Record<string, unknown> = { ...(record.claims ?? {}) }
  if (typeof subject.id !== 'string') delete subject.id

  // TrustService.saveMetadataEntry keys VT credentials by credentialSchema.id;
  // fall back to a stable URL when the applicant-supplied schemaId isn't a URL.
  const credentialSchema = {
    id:
      record.schemaId && /^https?:\/\//.test(record.schemaId)
        ? record.schemaId
        : `https://verana.io/schemas/vt-flow/${record.schemaId ?? 'default'}.json`,
    type: 'JsonSchemaCredential',
  }

  return {
    credentialFormats: {
      jsonld: {
        credential: {
          '@context': [
            'https://www.w3.org/2018/credentials/v1',
            'https://w3id.org/security/suites/ed25519-2020/v1',
            // Catch-all vocab so applicant-supplied claim keys pass safe-mode.
            // Replace with a concrete schema context once ECS contexts ship.
            { '@vocab': 'https://verana.io/schemas/vt-flow#' },
          ],
          type: ['VerifiableCredential'],
          issuer: issuerDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: subject,
          credentialSchema,
        },
        options: {
          proofType: 'Ed25519Signature2020',
          // Must match the signed proof's purpose or the applicant's
          // request/credential comparison rejects.
          proofPurpose: 'assertionMethod',
        },
      },
    },
    comment: `vt-flow credential for session ${record.sessionUuid}`,
  }
}
