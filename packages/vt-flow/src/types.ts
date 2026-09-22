import type { VtFlowErrorCode } from './errors'
import type { VtCredentialState } from './messages'
import type { BaseEvent } from '@credo-ts/core'
import type { DidCommDataIntegrityOfferCredentialFormat } from '@credo-ts/didcomm'

/** Role a party plays in a vt-flow session; perspective-only, never on the wire. */
export enum VtFlowRole {
  Applicant = 'applicant',
  Validator = 'validator',
}

/** OnboardingProcess (onboarding-request, GRANTOR/ECOSYSTEM onboarding modes) and DirectIssuance (issuance-request, HOLDER PERMISSIONLESS), ensuring type-safe flow handling. */
export enum VtFlowVariant {
  OnboardingProcess = 'onboarding-process',
  DirectIssuance = 'direct-issuance',
}

/** 20 Flow States covering both variants (AWAITING_*, *_SENT, OOB_PENDING, VALIDATING, VALIDATION_TX_*, VALIDATED, VALIDATED_PENDING_CLAIMS, CRED_OFFERED, COMPLETED, CRED_REVOKED, TERMINATED_BY_*, ERROR, PARTICIPANT_REVOKED, PARTICIPANT_SLASHED). */
export enum VtFlowState {
  AwaitingOp = 'AWAITING_OP',
  OrSent = 'OR_SENT',
  AwaitingOr = 'AWAITING_OR',
  IrSent = 'IR_SENT',
  AwaitingIr = 'AWAITING_IR',
  OobPending = 'OOB_PENDING',
  Validating = 'VALIDATING',
  AwaitingValidationTx = 'AWAITING_VALIDATION_TX',
  ValidationTxSubmitted = 'VALIDATION_TX_SUBMITTED',
  ValidationTxFailed = 'VALIDATION_TX_FAILED',
  Validated = 'VALIDATED',
  ValidatedPendingClaims = 'VALIDATED_PENDING_CLAIMS',
  CredOffered = 'CRED_OFFERED',
  Completed = 'COMPLETED',
  CredRevoked = 'CRED_REVOKED',
  TerminatedByValidator = 'TERMINATED_BY_VALIDATOR',
  TerminatedByApplicant = 'TERMINATED_BY_APPLICANT',
  Error = 'ERROR',
  ParticipantRevoked = 'PARTICIPANT_REVOKED',
  ParticipantSlashed = 'PARTICIPANT_SLASHED',
}

/** Terminal states; Connection State is implicitly `TERMINATED` for each. */
export const VtFlowTerminalStates: ReadonlySet<VtFlowState> = new Set([
  VtFlowState.TerminatedByValidator,
  VtFlowState.TerminatedByApplicant,
  VtFlowState.Error,
  VtFlowState.ParticipantRevoked,
  VtFlowState.ParticipantSlashed,
])

/** Validator states that `SetParticipantOPtoValidated` on-chain moves to `VALIDATED` ([VSA-VTI-FLOW-OP-ISSUE]). */
export const VtFlowValidatedFromStates: ReadonlySet<VtFlowState> = new Set([
  VtFlowState.Validating,
  VtFlowState.OobPending,
  VtFlowState.AwaitingValidationTx,
  VtFlowState.ValidationTxSubmitted,
  VtFlowState.ValidationTxFailed,
])

export function isVtFlowTerminalState(state: VtFlowState): boolean {
  return VtFlowTerminalStates.has(state)
}

export enum VtFlowEventTypes {
  VtFlowStateChanged = 'VtFlowStateChanged',
}

/** Emitted every time a VtFlowRecord's Flow State changes; `previousState` is null on first write. The DIDComm connection lifecycle is observed by the caller via Credo's `DidCommConnectionStateChangedEvent`. */
export interface VtFlowStateChangedEvent extends BaseEvent {
  type: typeof VtFlowEventTypes.VtFlowStateChanged
  payload: {
    vtFlowRecordId: string
    threadId: string
    participantSessionId: string
    state: VtFlowState
    previousState: VtFlowState | null
  }
}

/** The party that must act for a flow to progress, per the [VSA-ADM-VT-FL-LIST] pendingAction table. */
export enum VtFlowPendingAction {
  Applicant = 'APPLICANT',
  Validator = 'VALIDATOR',
  Agent = 'AGENT',
  Chain = 'CHAIN',
  None = 'NONE',
}

/** Who submitted `SetParticipantOPtoValidated`. */
export enum VtFlowSubmission {
  Agent = 'AGENT',
  Operator = 'OPERATOR',
}

/** Why a flow transaction failed, per [VSA-ADM-VT-FL-VALIDATE-9]. */
export enum VtFlowTxReason {
  InsufficientFundsAgent = 'INSUFFICIENT_FUNDS_AGENT',
  InsufficientFundsCorporation = 'INSUFFICIENT_FUNDS_CORPORATION',
  FeegrantExhausted = 'FEEGRANT_EXHAUSTED',
  FeegrantExpired = 'FEEGRANT_EXPIRED',
  AuthorizationExpired = 'AUTHORIZATION_EXPIRED',
  BroadcastError = 'BROADCAST_ERROR',
  TxFailed = 'TX_FAILED',
  TxNotFound = 'TX_NOT_FOUND',
}

export enum VtFlowTxStatus {
  Submitted = 'SUBMITTED',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
}

/** Outcome of a flow transaction; `height` and `reason` appear once the chain resolved it. */
export interface VtFlowTx {
  hash?: string
  height?: number
  status: VtFlowTxStatus
  reason?: VtFlowTxReason
  error?: string
}

/** The validation decision of an Onboarding Process flow, recorded by `validateFlow`. Discounts are decimals between 0 and 1. */
export interface VtFlowValidation {
  decidedAt: string
  submission: VtFlowSubmission
  validationFees?: number
  issuanceFees?: number
  verificationFees?: number
  issuanceFeeDiscount?: number
  verificationFeeDiscount?: number
  effectiveUntil?: string
  opSummaryDigest?: string
  tx?: VtFlowTx
}

/** Outcome of the `CreateOrUpdateParticipantSession` transaction that anchors the issued credential. */
export interface VtFlowIssuance {
  tx?: VtFlowTx
}

/** Kind of a human-readable flow message recorded in `messages[]`. */
export enum VtFlowMessageType {
  OobLink = 'oob-link',
  Validating = 'validating',
  ProblemReport = 'problem-report',
}

/** One human-readable message of a flow; `url` is set for an `oob-link` only. Timestamps are ISO 8601, the record is stored as JSON. */
export interface VtFlowMessage {
  type: VtFlowMessageType
  text: string
  at: string
  url?: string
}

/** The outstanding `oob-link` of a flow; `at` is when the agent sent or received the message. */
export interface VtFlowOobLink {
  url: string
  description: string
  expiresAt?: string
  at: string
}

export interface SendOnboardingRequestOptions {
  connectionId: string
  participantSessionId?: string
  applicantParticipantId: string
  applicantParticipantRole?: number
  validatorParticipantId?: string
  agentParticipantId: string
  walletAgentParticipantId: string
  claims?: Record<string, unknown>
}

export interface ResendOnboardingRequestOptions {
  vtFlowRecordId: string
  connectionId: string
}

export interface SendIssuanceRequestOptions {
  connectionId: string
  participantSessionId?: string
  schemaId: string
  agentParticipantId: string
  walletAgentParticipantId: string
  claims?: Record<string, unknown>
}

export interface OfferCredentialForSessionOptions {
  vtFlowRecordId: string
  /** W3C Data Integrity attachment format (Aries RFC 0809); the offered credential may use VC Data Model 1.1 or 2.0 */
  credentialFormats: { dataIntegrity: DidCommDataIntegrityOfferCredentialFormat }
  credentialDigest?: string
  issuerParticipantId?: number
  comment?: string
  goal?: string
  goalCode?: string
}

export interface SendOobLinkOptions {
  vtFlowRecordId: string
  url: string
  description: string
  expiresTime?: Date
}

export interface ProblemReportDispatchOptions {
  vtFlowRecordId: string
  code: VtFlowErrorCode
  enDescription?: string
  fixHintEn?: string
}

export interface NotifyCredentialStateChangeOptions {
  vtFlowRecordId: string
  state: VtCredentialState | string
  subprotocolThid?: string
  reason?: string
}
