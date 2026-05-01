import { BaseLogger, JsonObject } from '@credo-ts/core'

/** Permission type values per `verana.perm.v1.PermissionType`. */
export const PermissionType = {
  UNSPECIFIED: 0,
  ISSUER: 1,
  VERIFIER: 2,
  ISSUER_GRANTOR: 3,
  VERIFIER_GRANTOR: 4,
  ECOSYSTEM: 5,
  HOLDER: 6,
} as const
export type PermissionType = (typeof PermissionType)[keyof typeof PermissionType]

/**
 * Subset of `verana.perm.v1.Permission` consumed at this SDK boundary. Mirrors
 * the codec interface but is declared locally to keep imports off the
 * `@verana-labs/verana-types` codec subpath.
 */
export interface Permission {
  id: number
  schemaId: number
  type: PermissionType
  did: string
  validatorPermId: number
  vpSummaryDigest: string
  revoked: Date | undefined
  slashed: Date | undefined
}

export const VERANA_BECH32_PREFIX = 'verana'
export const RECORD_ID = 'verana-blockchain-sync-state'

export interface IndexerEventsResponse {
  events: JsonObject[]
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
