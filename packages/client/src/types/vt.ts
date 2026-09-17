import { PaginationQuery, VtConnectionState, VtFlowRole, VtFlowState, VtFlowVariant } from './common'

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
  participantId?: string
  schemaId?: string
  claims?: Record<string, unknown>
  proofs?: unknown[]
  oobLinkUrl?: string
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
  participantId?: string
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
