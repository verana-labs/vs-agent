import { AgentContext, DidDocument, DidRecord, DidRepository, Logger } from '@credo-ts/core'

import { getLegacyDidWeb } from '../legacyDidWeb'

import { migrateWebVhLogIfBroken } from './migrateWebVhLog'
import { migrateWebVhVersionTimeIfBroken } from './migrateWebVhVersionTime'

export { migrateWebVhLogIfBroken } from './migrateWebVhLog'
export { migrateWebVhVersionTimeIfBroken } from './migrateWebVhVersionTime'

const LEGACY_VERIFICATION_METHOD_TYPES = ['Ed25519VerificationKey2018', 'X25519KeyAgreementKey2019']

export interface LegacyDidRecordMigrationOptions {
  method: string
  logger: Logger
}

/**
 * Brings a persisted public DID record created by an earlier VS Agent version up to date.
 * The agent supports no DID change during its lifecycle, so every step here runs only after
 * an upgrade.
 * TODO (last legacy version: v1.11): remove this module once upgrading from v1.11 or earlier
 * is out of support.
 */
export async function migrateLegacyDidRecord(
  agentContext: AgentContext,
  record: DidRecord,
  options: LegacyDidRecordMigrationOptions,
): Promise<void> {
  const { method, logger } = options

  if (method !== 'webvh') return

  // <2.7.4 wrote broken entry hashes (SCID placeholder), and >=2.8.0 rejects the same-second
  // versionTimes the old create+update-at-init flow produced. Both rebuild the log in-place,
  // preserving entry #1 and therefore the SCID and the public DID.
  try {
    await migrateWebVhVersionTimeIfBroken(agentContext, record, logger)
    await migrateWebVhLogIfBroken(agentContext, record, logger)
  } catch (error) {
    logger.error(
      `Failed to migrate webvh DID log for ${record.did}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    throw error
  }

  await addLegacyDidWebAlternative(agentContext, record, logger)
  await repairWebvhUpdateKeyMapping(agentContext, record, logger)
}

/**
 * Records published before the 2020 key types landed still carry 2018/2019 verification methods.
 * TODO (last legacy version: v1.5): remove once upgrading from v1.5 or earlier is out of support.
 */
export function hasLegacyVerificationMethods(didDocument: DidDocument): boolean {
  return (didDocument.verificationMethod ?? []).some(vm => LEGACY_VERIFICATION_METHOD_TYPES.includes(vm.type))
}

/** did:webvh records published before authentication-replace landed carry the didwebvh-ts update key. */
export function authenticationHasUpdateKey(
  didDocument: DidDocument,
  method: string,
  ed25519VerificationMethodId?: string,
): boolean {
  if (method !== 'webvh' || !ed25519VerificationMethodId) return false

  return (didDocument.authentication ?? []).some(entry => {
    const id = typeof entry === 'string' ? entry : entry.id
    return id !== ed25519VerificationMethodId
  })
}

/** The did:web form as an alternative DID, so implicit invitations resolve to the same record. */
async function addLegacyDidWebAlternative(
  agentContext: AgentContext,
  record: DidRecord,
  logger: Logger,
): Promise<void> {
  const legacyDid = getLegacyDidWeb(record.did)
  if (!legacyDid) return

  const alternativeDids = record.getTag('alternativeDids') as string[] | undefined
  if (alternativeDids?.includes(legacyDid)) return

  logger.debug('Adding did:web form as an alternative DID')
  record.setTag('alternativeDids', [legacyDid])
  await agentContext.dependencyManager.resolve(DidRepository).update(agentContext, record)
}

/**
 * Fix a webvh update-key mapping whose `didDocumentRelativeKeyId` was stored as the full multibase
 * (e.g. `#z6Mk...`) while the DID document verification method uses a short fragment (e.g. `#BVhGnL79`).
 * `getKmsKeyIdForVerifiacationMethod` matches by suffix (`vm.id.endsWith(relativeKeyId)`), so the
 * mismatch leaves the update key unresolvable and every webvh update fails with
 * "The key ID must be present before the log can be edited." The private key is present in the KMS;
 * only the mapping label is wrong. Idempotent: a mapping that already correlates to a VM is left alone.
 */
async function repairWebvhUpdateKeyMapping(
  agentContext: AgentContext,
  record: DidRecord,
  logger: Logger,
): Promise<void> {
  if (!record.didDocument || !record.keys?.length) return

  const vms = record.didDocument.verificationMethod ?? []
  let repaired = false

  for (const key of record.keys) {
    const rel = key.didDocumentRelativeKeyId
    if (vms.some(vm => vm.id.endsWith(rel))) continue // already correlates

    const vm = vms.find(v => `#${v.publicKeyMultibase}` === rel) // was stored as #<multibase>
    if (!vm) continue

    const correct = `#${vm.id.split('#')[1]}`
    if (correct !== rel) {
      logger.warn('Fixing webvh update-key mapping', { from: rel, to: correct, kmsKeyId: key.kmsKeyId })
      key.didDocumentRelativeKeyId = correct
      repaired = true
    }
  }

  if (repaired) {
    await agentContext.dependencyManager.resolve(DidRepository).update(agentContext, record)
  }
}
