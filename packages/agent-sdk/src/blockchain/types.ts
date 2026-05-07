import { BaseLogger } from '@credo-ts/core'

/** Permission type for a HOLDER permission per `verana.perm.v1.PermissionType.HOLDER`. */
export const HOLDER_PERMISSION_TYPE = 6

/**
 * Subset of `verana.perm.v1.Permission` consumed at this SDK boundary. Mirrors
 * the codec interface but is declared locally to keep imports off the
 * `@verana-labs/verana-types` codec subpath.
 */
export interface Permission {
  id: number
  schemaId: number
  type: number
  did: string
  validatorPermId: number
  vpSummaryDigest: string
  revoked: Date | undefined
  slashed: Date | undefined
}

export const VERANA_BECH32_PREFIX = 'verana'
export const RECORD_ID = 'verana-blockchain-sync-state'

export type IndexerEventRecord = {
  type: 'indexer-event'
  event_type: string
  did: string
  block_height: number
  tx_hash: string
  timestamp: string
  payload: {
    module: string
    action: string
    message_type: string
    tx_index: number
    message_index: number
    sender: string
    related_dids: string[]
    entity_type?: string
    entity_id?: string
  }
}

export interface IndexerEventsResponse {
  events: IndexerEventRecord[]
  count: number
  after_block_height: number
}

export type IndexerEntityType =
  | 'TrustRegistry'
  | 'CredentialSchema'
  | 'Permission'
  | 'PermissionSession'
  | 'TrustDeposit'

export interface IndexerActivity {
  timestamp: string
  block_height: string | number
  entity_type: IndexerEntityType | string
  entity_id: string
  msg: string
  changes: Record<string, unknown>
  account?: string
}

export interface IndexerChangesResponse {
  block_height: number
  next_change_at: number | null
  activity: IndexerActivity[]
}

export interface VeranaIdxConfig {
  baseUrl: string
  logger: BaseLogger
}

export interface SyncedTrustRegistry {
  id: number
  did: string
  controller: string
  archived: boolean
  activeGfVersion?: number
  lastModifiedBlock: number
}

export interface SyncedCredentialSchema {
  id: number
  trId: number
  jsonSchema: string
  issuerMode?: string
  verifierMode?: string
  archived: boolean
  lastModifiedBlock: number
}

export interface SyncedPermission {
  id: number
  schemaId: number
  did: string
  type: number
  vpState?: string
  effectiveUntil?: string
  revoked: boolean
  slashed: boolean
  lastModifiedBlock: number
}

export interface VeranaSyncState {
  lastBlockHeight: number
  trustRegistries: Record<string, SyncedTrustRegistry>
  credentialSchemas: Record<string, SyncedCredentialSchema>
  permissions: Record<string, SyncedPermission>
}

export interface TrustRegistryDto {
  id: number
  did: string
  controller: string
  archived: string | null
  active_gf_version?: number
}

export interface CredentialSchemaDto {
  id: number
  tr_id: number
  json_schema: string
  issuer_perm_management_mode?: string
  verifier_perm_management_mode?: string
  archived: string | null
  created: string
  modified: string
}

export interface PermissionDto {
  id: number
  schema_id: number
  did: string | null
  type: number
  perm_state: 'ACTIVE' | 'REVOKED' | 'SLASHED' | 'REPAID' | 'EXPIRED' | 'FUTURE' | 'INACTIVE'
  vp_state?: string
  revoked: string | null
  slashed: string | null
  effective_until?: string
  modified: string
  validator_perm_id: number | null
  is_active_now: boolean
  // Please confirm if 'vp_summary_digest' is the right name for v4 spec.
  // I'm assuming the vp_summary_digest_sri is for v3 spec as confirmed with the current onchain data here: https://idx.testnet.verana.network/verana/perm/v1/get/1
  vp_summary_digest?: string
}

export interface PermQueryClient {
  GetPermission(req: { id: number }): Promise<{ permission?: Permission }>
  FindPermissionsWithDID(req: object): Promise<{ permissions: Permission[] }>
  GetPermissionSession(req: { id: string }): Promise<{ session?: unknown }>
}

export interface VeranaChainConfig {
  rpcUrl: string
  chainId?: string
  mnemonic: string
  logger: BaseLogger
  gasPrice?: string
}

/** Wrapper for optional uint64 values per `verana.perm.v1.OptionalUInt64`. */
export interface OptionalUInt64 {
  value: number
}

export interface StartPermissionVPParams {
  type: number
  validatorPermId: number
  did: string
  validationFees?: OptionalUInt64
  issuanceFees?: OptionalUInt64
  verificationFees?: OptionalUInt64
}

export interface SetPermissionVPToValidatedParams {
  id: number
  effectiveUntil?: Date
  validationFees?: number
  issuanceFees?: number
  verificationFees?: number
  vpSummaryDigest: string
  issuanceFeeDiscount?: number
  verificationFeeDiscount?: number
}

export interface CreateOrUpdatePermissionSessionParams {
  id: string
  issuerPermId?: number
  verifierPermId?: number
  agentPermId: number
  walletAgentPermId: number
  digest?: string
}
