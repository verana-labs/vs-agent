export interface PaginationQuery {
  limit?: number
  cursor?: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface SentMessage {
  id: string
}

export interface Claim {
  name: string
  value: string
  mimeType?: string
}

export interface RequestedCredential {
  credentialDefinitionId?: string
  jsonSchemaCredentialId?: string
  attributes?: string[]
}

export type DidExchangeState =
  | 'start'
  | 'invitation-sent'
  | 'invitation-received'
  | 'request-sent'
  | 'request-received'
  | 'response-sent'
  | 'response-received'
  | 'abandoned'
  | 'completed'

export type DidExchangeRole = 'requester' | 'responder'

export type BasicMessageRole = 'sender' | 'receiver'

export type ProofState =
  | 'proposal-sent'
  | 'proposal-received'
  | 'request-sent'
  | 'request-received'
  | 'presentation-sent'
  | 'presentation-received'
  | 'declined'
  | 'abandoned'
  | 'done'

export type ProofRole = 'verifier' | 'prover'

export type CredentialState =
  | 'proposal-sent'
  | 'proposal-received'
  | 'offer-sent'
  | 'offer-received'
  | 'declined'
  | 'request-sent'
  | 'request-received'
  | 'credential-issued'
  | 'credential-received'
  | 'done'
  | 'abandoned'

export type CredentialRole = 'issuer' | 'holder'

export type DidCommVersion = 'v1' | 'v2'

export type VtFlowRole = 'applicant' | 'validator'

export type VtFlowVariant = 'onboarding-process' | 'direct-issuance'

export type VtFlowState =
  | 'AWAITING_OP'
  | 'OR_SENT'
  | 'AWAITING_OR'
  | 'IR_SENT'
  | 'AWAITING_IR'
  | 'OOB_PENDING'
  | 'VALIDATING'
  | 'AWAITING_VALIDATION_TX'
  | 'VALIDATION_TX_SUBMITTED'
  | 'VALIDATION_TX_FAILED'
  | 'VALIDATED'
  | 'VALIDATED_PENDING_CLAIMS'
  | 'CRED_OFFERED'
  | 'COMPLETED'
  | 'CRED_REVOKED'
  | 'TERMINATED_BY_VALIDATOR'
  | 'TERMINATED_BY_APPLICANT'
  | 'ERROR'
  | 'PARTICIPANT_REVOKED'
  | 'PARTICIPANT_SLASHED'

export type VtConnectionState = 'NOT_CONNECTED' | 'ESTABLISHED' | 'TERMINATED'
