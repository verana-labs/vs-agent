import { PaginationQuery, VtConnectionState, VtFlowRole, VtFlowState, VtFlowVariant } from './common'

export type VtFlowPendingAction = 'APPLICANT' | 'VALIDATOR' | 'AGENT' | 'CHAIN' | 'NONE'

export interface VtFlowOobLink {
  url: string
  description: string
  expiresAt?: string
  at: string
}

export interface VtFlowMessage {
  type: 'oob-link' | 'validating' | 'problem-report'
  text: string
  at: string
  url?: string
}

export interface VtFlowTx {
  hash?: string
  height?: number
  status: 'SUBMITTED' | 'SUCCEEDED' | 'FAILED'
  reason?: string
  error?: string
}

export interface VtFlowValidation {
  decidedAt: string
  submission: 'AGENT' | 'OPERATOR'
  validationFees?: number
  issuanceFees?: number
  verificationFees?: number
  issuanceFeeDiscount?: number
  verificationFeeDiscount?: number
  effectiveUntil?: string
  opSummaryDigest?: string
  tx?: VtFlowTx
}

export interface VtFlowRecord {
  id: string
  participantSessionId: string
  flowState: VtFlowState
  connectionState: VtConnectionState
  role: VtFlowRole
  variant: VtFlowVariant
  threadId: string
  connectionId: string
  agentParticipantId: string
  walletAgentParticipantId: string
  peerDid?: string
  applicantParticipantId?: string
  validatorParticipantId?: string
  schemaId?: string
  claims?: Record<string, unknown>
  proofs?: unknown[]
  oobLink?: VtFlowOobLink
  messages: VtFlowMessage[]
  pendingAction: VtFlowPendingAction
  validation?: VtFlowValidation
  issuance?: { tx?: VtFlowTx }
  credentialExchangeRecordId?: string
  credentialDigest?: string
  subprotocolThid?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
  lastEventAt: string
}

export interface ListFlowsQuery extends PaginationQuery {
  role?: VtFlowRole
  connectionState?: VtConnectionState
  flowState?: VtFlowState
  peerDid?: string
  applicantParticipantId?: string
  validatorParticipantId?: string
  schemaId?: string
  participantSessionId?: string
}

export interface EditClaimsBody {
  claims: Record<string, unknown>
}

export interface SendOobLinkBody {
  url: string
  message?: string
}

export interface RevokeFlowCredentialBody {
  reason?: string
}

export type ServiceEndpointValue = string | Record<string, unknown> | Array<string | Record<string, unknown>>

export interface ServiceEndpoint {
  id: string
  type: string
  serviceEndpoint: ServiceEndpointValue
}

export interface AddServiceEndpointBody {
  type: string
  serviceEndpoint: ServiceEndpointValue
  id?: string
}

export interface UpdateServiceEndpointBody {
  type?: string
  serviceEndpoint?: ServiceEndpointValue
}
