import { JsonObject } from '@credo-ts/core'

import { VsAgent } from '../agent/VsAgent'

import { IndexerActivity, RECORD_ID, VeranaSyncState } from './types'

export function applyActivity(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes

  switch (activity.entity_type) {
    case 'TrustRegistry': {
      state.trustRegistries[id] = {
        id: Number(id),
        did: String(c['did']),
        controller: String(c['controller']),
        archived: Boolean(c['archived']),
        lastModifiedBlock: block,
      }
      break
    }

    case 'CredentialSchema': {
      const existing = state.credentialSchemas[id]
      state.credentialSchemas[id] = {
        id: Number(id),
        trId: Number(c['tr_id']),
        jsonSchema: String(c['json_schema'] ?? existing?.jsonSchema ?? ''),
        issuerMode: c['issuer_perm_management_mode']
          ? String(c['issuer_perm_management_mode'])
          : existing?.issuerMode,
        verifierMode: c['verifier_perm_management_mode']
          ? String(c['verifier_perm_management_mode'])
          : existing?.verifierMode,
        archived:
          activity.msg === 'ArchiveCredentialSchema'
            ? Boolean(c['archived'] ?? true)
            : (existing?.archived ?? false),
        lastModifiedBlock: block,
      }
      break
    }

    case 'Permission': {
      state.permissions[id] = {
        id: Number(id),
        schemaId: Number(c['schema_id']),
        did: String(c['did'] ?? ''),
        type: Number(c['type']),
        vpState: String(c['vp_state'] ?? ''),
        effectiveUntil: String(c['effective_until'] ?? ''),
        revoked: Boolean(c['revoked']),
        slashed: Boolean(c['slashed']),
        lastModifiedBlock: block,
      }
      break
    }

    default:
      break
  }

  state.lastBlockHeight = Math.max(state.lastBlockHeight, block)
}

const emptyState = (): VeranaSyncState => ({
  lastBlockHeight: 0,
  trustRegistries: {},
  credentialSchemas: {},
  permissions: {},
})

export async function loadSyncState(agent: VsAgent): Promise<VeranaSyncState> {
  const record = await agent.genericRecords.findById(RECORD_ID)
  if (!record) return emptyState()
  return (record.content as unknown as VeranaSyncState) ?? emptyState()
}

export async function saveSyncState(agent: VsAgent, state: VeranaSyncState): Promise<void> {
  const existing = await agent.genericRecords.findById(RECORD_ID)
  if (existing) {
    existing.content = state as unknown as JsonObject
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ id: RECORD_ID, content: state as unknown as JsonObject })
  }
}
