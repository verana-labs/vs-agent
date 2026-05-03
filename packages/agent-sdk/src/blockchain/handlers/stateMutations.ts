import { computeSchemaDigest } from '@verana-labs/vs-agent-model'

import { VsAgent } from '../../agent/VsAgent'
import { getEcsSchemas } from '../../utils/data'
import { createJsc, findMetadataEntry, removeTrustCredential } from '../../utils/trustCredentialStore'
import { IndexerActivity, VeranaSyncState } from '../types'

const DEFAULT_CHAIN_ID = 'vna-testnet-1'

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

export function upsertCredentialSchema(state: VeranaSyncState, activity: IndexerActivity): void {
  const block = Number(activity.block_height) || 0
  const id = String(activity.entity_id)
  const c = activity.changes
  const existing = state.credentialSchemas[id]

  const archivedRaw = c['archived']
  const archived =
    archivedRaw !== undefined ? archivedRaw !== null && archivedRaw !== false : (existing?.archived ?? false)

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
    archived,
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

export async function publishVtjscIfOwner(
  state: VeranaSyncState,
  agent: VsAgent,
  schemaEntityId: string,
): Promise<void> {
  const schema = state.credentialSchemas[schemaEntityId]
  if (!schema) {
    agent.config.logger.warn(`[VTJSC] Schema ${schemaEntityId} not found in state`)
  }

  const tr = state.trustRegistries[String(schema.trId)]
  if (!tr) {
    agent.config.logger.warn(`[VTJSC] Trust Registry ${schema.trId} not found in state`)
  }

  const chainId = agent.veranaChain?.getChainId ?? DEFAULT_CHAIN_ID
  const jsonSchemaRef = `vpr:verana:${chainId}/cs/v1/js/${schema.id}`

  let digestSRI: string
  try {
    digestSRI = await computeSchemaDigest(JSON.parse(schema.jsonSchema))
  } catch (e) {
    agent.config.logger.error(`[VTJSC] Failed to parse/digest schema ${schemaEntityId}`, e as Error)
    return
  }

  try {
    await createJsc(agent, agent.publicApiBaseUrl, getEcsSchemas(agent.publicApiBaseUrl), {
      schemaBaseId: String(schema.id),
      jsonSchemaRef,
      precomputedDigestSRI: digestSRI,
    })
    agent.config.logger.info(
      `[VTJSC] Published VTJSC for schema ${schema.id} (TR ${schema.trId}) at block ${state.lastBlockHeight}`,
    )
  } catch (e) {
    agent.config.logger.error(`[VTJSC] Failed to publish VTJSC for schema ${schema.id}`, e as Error)
  }
}
