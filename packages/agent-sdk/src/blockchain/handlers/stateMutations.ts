import { IndexerActivity, VeranaSyncState } from '../types'

export function upsertTrustRegistry(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.trustRegistries[id]

  state.trustRegistries[id] = {
    id: Number(id),
    did: String(c['did'] ?? existing?.did ?? ''),
    controller: String(c['controller'] ?? existing?.controller ?? ''),
    archived: Boolean(c['archived'] ?? existing?.archived ?? false),
    activeGfVersion: existing?.activeGfVersion,
    lastModifiedBlock: block,
  }
}

export function bumpActiveGfVersion(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const existing = state.trustRegistries[id]

  state.trustRegistries[id] = {
    id: Number(id),
    did: String(existing?.did ?? ''),
    controller: String(existing?.controller ?? ''),
    archived: existing?.archived ?? false,
    activeGfVersion: (existing?.activeGfVersion ?? 0) + 1,
    lastModifiedBlock: block,
  }
}

export function upsertCredentialSchema(
  state: VeranaSyncState,
  activity: IndexerActivity,
  opts: { toggleArchived?: boolean } = {},
): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.credentialSchemas[id]

  state.credentialSchemas[id] = {
    id: Number(id),
    trId: Number(c['tr_id'] ?? existing?.trId ?? 0),
    jsonSchema: String(c['json_schema'] ?? existing?.jsonSchema ?? ''),
    issuerMode: c['issuer_perm_management_mode']
      ? String(c['issuer_perm_management_mode'])
      : existing?.issuerMode,
    verifierMode: c['verifier_perm_management_mode']
      ? String(c['verifier_perm_management_mode'])
      : existing?.verifierMode,
    archived: opts.toggleArchived ? !(existing?.archived ?? false) : (existing?.archived ?? false),
    lastModifiedBlock: block,
  }
}

export function upsertPermission(
  state: VeranaSyncState,
  activity: IndexerActivity,
  overrides: {
    vpState?: string
    revoked?: boolean
    slashed?: boolean
    effectiveUntil?: string
  } = {},
): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.permissions[id]

  state.permissions[id] = {
    id: Number(id),
    schemaId: Number(c['schema_id'] ?? existing?.schemaId ?? 0),
    did: String(c['did'] ?? existing?.did ?? ''),
    type: Number(c['type'] ?? existing?.type ?? 0),
    vpState: overrides.vpState ?? String(c['vp_state'] ?? existing?.vpState ?? ''),
    effectiveUntil: overrides.effectiveUntil ?? existing?.effectiveUntil ?? '',
    revoked: overrides.revoked ?? existing?.revoked ?? false,
    slashed: overrides.slashed ?? existing?.slashed ?? false,
    lastModifiedBlock: block,
  }
}
