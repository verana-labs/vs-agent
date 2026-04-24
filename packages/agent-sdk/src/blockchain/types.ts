import { BaseLogger } from '@credo-ts/core'

export const VERANA_BECH32_PREFIX = 'verana'

import { JsonObject } from '@credo-ts/core'

export interface IndexerEventsResponse {
  events: JsonObject[]
  count: number
  after_block_height: number

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
