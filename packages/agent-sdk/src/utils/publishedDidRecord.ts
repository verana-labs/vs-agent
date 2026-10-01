import { DidRecord, DidRepository } from '@credo-ts/core'

import { VsAgent } from '../agent/VsAgent'
import { scheduleTriggerResolverForOwnDid } from '../blockchain/triggerResolver'
import { applyAdminApiServiceEntry } from '../did/adminApiService'

/**
 * The one write point of the published Verifiable Trust material: the `_vt/vtc` and `_vt/jsc`
 * metadata of the DID record and the DID Document that announces them. [VSA-VT-LVP-5] asks for a
 * `TriggerResolver` after each change of a `LinkedVerifiablePresentation` entry, so the decision
 * lives here rather than in each caller: the stored record is compared with the one written. The DID
 * Document is published only when it changed, so a metadata-only write adds no `did:webvh` version.
 */
export async function updateDidRecord(agent: VsAgent, didRecord: DidRecord): Promise<void> {
  const repo = agent.context.dependencyManager.resolve(DidRepository)
  applyAdminApiServiceEntry(didRecord.didDocument!, agent.adminApiServiceEndpoint)
  const stored = await storedRecord(agent, repo, didRecord.id)
  const publishedBefore = publicationFingerprint(stored)
  const documentBefore = documentFingerprint(stored)

  await repo.update(agent.context, didRecord)
  if (documentFingerprint(didRecord) !== documentBefore) {
    await agent.dids.update({ did: didRecord.did, didDocument: didRecord.didDocument! })
  }
  if (publicationFingerprint(didRecord) !== publishedBefore) {
    scheduleTriggerResolverForOwnDid(agent, 'the published Verifiable Trust material changed')
  }
}

async function storedRecord(agent: VsAgent, repo: DidRepository, id: string): Promise<DidRecord | null> {
  try {
    return await repo.findById(agent.context, id)
  } catch (error) {
    agent.config.logger.debug(
      `[trust-credential] cannot read the stored DID record: ${(error as Error).message}`,
    )
    return null
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// a document saved as a class instance reads back from storage as JSON, so both go through JSON
function asJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** What the agent serves as its DID Document. Two records with the same fingerprint serve the same. */
function documentFingerprint(didRecord: DidRecord | null): string {
  if (!didRecord?.didDocument) return ''
  return stableStringify(asJson(didRecord.didDocument))
}

/**
 * What a trust resolver reads of the agent: its `LinkedVerifiablePresentation` entries, and the
 * presentations behind them. Two records with the same fingerprint resolve the same way.
 */
export function publicationFingerprint(didRecord: DidRecord | null): string {
  if (!didRecord) return ''
  const services = (didRecord.didDocument?.service ?? [])
    .filter(service => service.type === 'LinkedVerifiablePresentation')
    .map(service => ({ id: service.id, serviceEndpoint: service.serviceEndpoint }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const presentations = (['_vt/vtc', '_vt/jsc'] as const).map(key =>
    Object.entries(didRecord.metadata.get(key) ?? {})
      .map(([schemaId, entry]) => ({
        schemaId,
        presentation: (entry as { verifiablePresentation?: unknown }).verifiablePresentation,
      }))
      .sort((a, b) => a.schemaId.localeCompare(b.schemaId)),
  )
  return stableStringify(asJson({ services, presentations }))
}
