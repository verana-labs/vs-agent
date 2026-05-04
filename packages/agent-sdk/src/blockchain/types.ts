import { BaseLogger } from '@credo-ts/core'

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
}

export interface PermQueryClient {
  GetPermission(req: { id: Long }): Promise<{ permission?: unknown }>
  FindPermissionsWithDID(req: object): Promise<{ permissions: unknown[] }>
  GetPermissionSession(req: { id: string }): Promise<{ session?: unknown }>
}

export interface VeranaChainConfig {
  rpcUrl: string
  chainId?: string
  mnemonic: string
  logger: BaseLogger
  gasPrice?: string
}

export interface StartPermissionVPParams {
  type: number
  validatorPermId: Long
  country: string
  did: string
  validationFees?: { value: Long }
}

export interface SetPermissionVPToValidatedParams {
  id: Long
  effectiveUntil?: Date
  validationFees: Long
  issuanceFees: Long
  verificationFees: Long
  country: string
  vpSummaryDigestSri: string
  issuanceFeeDiscount: Long
  verificationFeeDiscount: Long
}

export interface CreateOrUpdatePermissionSessionParams {
  id: string
  issuerPermId: Long
  verifierPermId: Long
  agentPermId: Long
  walletAgentPermId: Long
}
