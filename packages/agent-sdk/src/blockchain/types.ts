import { BaseLogger } from '@credo-ts/core'

export enum ValidationState {
  UNSPECIFIED = 0,
  PENDING = 1,
  VALIDATED = 2,
  TERMINATED = 3,
}

export interface Participant {
  id: number
  schemaId: number
  role: number
  did: string
  corporation: string
  validatorParticipantId: number
  opState?: ValidationState
  opSummaryDigest: string
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
    corporation_id?: number
    related_corporation_ids?: number[]
  }
}

export interface IndexerReadyMessage {
  type: 'ready'
  block: number
  blockTime: string
  blockIntervalMs: number
}

export interface IndexerBlockMessage {
  type: 'block'
  block: number
  blockTime: string
  events: IndexerEventRecord[]
}

export interface IndexerSubscribeMessage {
  action: 'subscribe'
  dids?: string[]
  corporationId?: number
}

export interface IndexerEventsResponse {
  events: IndexerEventRecord[]
  count: number
  after_block_height: number
}

export type IndexerEntityType =
  | 'Ecosystem'
  | 'CredentialSchema'
  | 'Participant'
  | 'ParticipantSession'
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

export interface SyncedEcosystem {
  id: number
  did: string
  corporationId: number
  archived: boolean
  activeVersion?: number
  lastModifiedBlock: number
}

export interface SyncedCredentialSchema {
  id: number
  ecosystemId: number
  jsonSchema: string
  issuerMode?: string
  verifierMode?: string
  archived: boolean
  lastModifiedBlock: number
}

export interface SyncedParticipant {
  id: number
  schemaId: number
  did: string
  role: number
  opState?: string
  effectiveUntil?: string
  revoked: boolean
  slashed: boolean
  lastModifiedBlock: number
}

export interface VeranaSyncState {
  lastBlockHeight: number
  ecosystems: Record<string, SyncedEcosystem>
  credentialSchemas: Record<string, SyncedCredentialSchema>
  participants: Record<string, SyncedParticipant>
  partialBlock?: number
  partialKeys?: string[]
}

export interface EcosystemDto {
  id: number
  did: string
  corporation_id: number
  archived: string | null
  active_version?: number
}

export interface CredentialSchemaDto {
  id: number
  ecosystem_id: number
  json_schema: string
  issuer_onboarding_mode?: string
  verifier_onboarding_mode?: string
  archived: string | null
  created: string
  modified: string
}

export enum ParticipantRole {
  Issuer = 'ISSUER',
  Verifier = 'VERIFIER',
  IssuerGrantor = 'ISSUER_GRANTOR',
  VerifierGrantor = 'VERIFIER_GRANTOR',
  Ecosystem = 'ECOSYSTEM',
  Holder = 'HOLDER',
}

export enum ParticipantState {
  Active = 'ACTIVE',
  Future = 'FUTURE',
  Inactive = 'INACTIVE',
  Expired = 'EXPIRED',
  Revoked = 'REVOKED',
  Slashed = 'SLASHED',
  Repaid = 'REPAID',
}

export interface ParticipantDto {
  id: number
  schema_id: number
  did: string | null
  role: ParticipantRole
  participant_state?: ParticipantState
  op_state?: string
  revoked: string | null
  slashed: string | null
  effective_until?: string
  modified: string
  validator_participant_id?: number | null
  op_summary_digest?: string
}

export interface CorporationDto {
  id: number
  did?: string | null
}

export interface ParticipantSessionRecordDto {
  created?: string
  issuer_participant_id?: number
  verifier_participant_id?: number
  wallet_agent_participant_id?: number
  agent_participant_id?: number
}

export interface ParticipantSessionDto {
  id: string
  corporation_id?: number
  vs_operator?: string
  created?: string
  modified?: string
  session_records?: ParticipantSessionRecordDto[]
}

export interface DigestDto {
  digest: string
  created: string
}

export interface RawParticipant {
  id: number
  schemaId: number
  role: number
  did: string
  corporationId?: number
  validatorParticipantId: number
  opState?: number
  opSummaryDigest?: string
  revoked: Date | undefined
  slashed: Date | undefined
}

export interface Ecosystem {
  id: number
  did: string
  corporationId: number
  archived: boolean
  activeVersion: number
}

export interface CredentialSchema {
  id: number
  ecosystemId: number
  jsonSchema: string
  issuerOnboardingMode: number
  verifierOnboardingMode: number
  holderOnboardingMode: number
  archived: Date | undefined
}

export interface OperatorAuthorization {
  id: number
  corporationId: number
  operator: string
  msgTypes: string[]
}

export interface ParticipantAuthorizationRecord {
  participantId: number
  msgTypes: string[]
}

export interface VsOperatorAuthorization {
  id: number
  corporationId: number
  vsOperator: string
  records: ParticipantAuthorizationRecord[]
}

export interface ParticipantQueryClient {
  GetParticipant(req: { id: number }): Promise<{ participant?: RawParticipant }>
  FindParticipantsWithDID(req: object): Promise<{ participants: RawParticipant[] }>
  GetParticipantSession(req: { id: string }): Promise<{ session?: unknown }>
}

export interface EcosystemQueryClient {
  GetEcosystem(req: { id: number }): Promise<{ ecosystem?: Ecosystem }>
}

export interface CredentialSchemaQueryClient {
  GetCredentialSchema(req: { id: number }): Promise<{ schema?: CredentialSchema }>
}

export interface DelegationQueryClient {
  ListOperatorAuthorizations(req: {
    corporationId: number
    operator: string
    responseMaxSize: number
  }): Promise<{ operatorAuthorizations: OperatorAuthorization[] }>
  ListVSOperatorAuthorizations(req: {
    corporationId: number
    vsOperator: string
    responseMaxSize: number
  }): Promise<{ vsOperatorAuthorizations: VsOperatorAuthorization[] }>
}

export interface VeranaChainConfig {
  rpcUrl: string
  chainId?: string
  mnemonic: string
  sessionOperatorMnemonic?: string
  logger: BaseLogger
  gasPrice?: string
  corporationAddress?: string
  autoTriggerResolver?: boolean
}

/** Wrapper for optional uint64 values per `verana.pp.v1.OptionalUInt64`. */
export interface OptionalUInt64 {
  value: number
}

export interface StartParticipantOPParams {
  role: number
  validatorParticipantId: number
  did: string
  validationFees?: OptionalUInt64
  issuanceFees?: OptionalUInt64
  verificationFees?: OptionalUInt64
  vsOperator?: string
  vsOperatorAuthzMsgTypes?: string[]
}

export interface SetParticipantOPToValidatedParams {
  id: number
  effectiveUntil?: Date
  validationFees?: number
  issuanceFees?: number
  verificationFees?: number
  opSummaryDigest: string
  issuanceFeeDiscount?: number
  verificationFeeDiscount?: number
  corporation?: string
}

export interface CreateOrUpdateParticipantSessionParams {
  id: string
  issuerParticipantId?: number
  verifierParticipantId?: number
  agentParticipantId: number
  walletAgentParticipantId: number
  digest?: string
  corporation?: string
}

export interface Coin {
  denom: string
  amount: string
}

export interface DurationParam {
  seconds: number
  nanos?: number
}

export interface GrantOperatorAuthorizationParams {
  grantee: string
  msgTypes: string[]
  expiration?: Date
  authzSpendLimit?: Coin[]
  authzSpendLimitPeriod?: DurationParam
  withFeegrant?: boolean
  feegrantSpendLimit?: Coin[]
  feegrantSpendLimitPeriod?: DurationParam
  feeSpendLimit?: Coin[]
}

export interface RevokeOperatorAuthorizationParams {
  grantee: string
}

export interface CreateEcosystemParams {
  did: string
  language: string
  docUrl: string
  docDigestSri: string
  aka?: string
}

export interface ArchiveEcosystemParams {
  ecosystemId: number
  archive: boolean
}

/** Wrapper for optional uint32 values per `verana.cs.v1.OptionalUInt32`. */
export interface OptionalUInt32 {
  value: number
}

export interface CreateCredentialSchemaParams {
  ecosystemId: number
  jsonSchema: string
  issuerOnboardingMode?: number
  verifierOnboardingMode?: number
  holderOnboardingMode?: number
  pricingAssetType?: number
  pricingAsset?: string
  digestAlgorithm?: string
  issuerGrantorValidationValidityPeriod?: OptionalUInt32
  verifierGrantorValidationValidityPeriod?: OptionalUInt32
  issuerValidationValidityPeriod?: OptionalUInt32
  verifierValidationValidityPeriod?: OptionalUInt32
  holderValidationValidityPeriod?: OptionalUInt32
}

export interface CreateRootParticipantParams {
  schemaId: number
  did: string
  effectiveFrom?: Date
  effectiveUntil?: Date
  validationFees?: number
  issuanceFees?: number
  verificationFees?: number
}

export interface SelfCreateParticipantParams {
  role: number
  validatorParticipantId: number
  did: string
  effectiveFrom?: Date
  effectiveUntil?: Date
  validationFees?: number
  verificationFees?: number
  vsOperator?: string
  vsOperatorAuthzMsgTypes?: string[]
  vsOperatorAuthzSpendLimit?: Coin[]
  vsOperatorAuthzWithFeegrant?: boolean
  vsOperatorAuthzFeeSpendLimit?: Coin[]
  vsOperatorAuthzPeriod?: DurationParam
}
