import type { VtFlowErrorCode } from './errors'
import type { VtCredentialState } from './messages'
import type { BaseEvent } from '@credo-ts/core'
import type { DidCommJsonLdCredentialDetailFormat } from '@credo-ts/didcomm'

/** Role a party plays in a vt-flow session; perspective-only, never on the wire. */
export enum VtFlowRole {
  Applicant = 'applicant',
  Validator = 'validator',
}

/** Spec v4 (§5.1, §5.2): ValidationProcess (validation-request, GRANTOR/ECOSYSTEM) and DirectIssuance (issuance-request, HOLDER/ISSUER), ensuring type-safe flow handling. */
export enum VtFlowVariant {
  ValidationProcess = 'validation-process',
  DirectIssuance = 'direct-issuance',
}

/** Spec v4 §5.6: 16 Flow States covering both variants (AWAITING_*, *_SENT, OOB_PENDING, VALIDATING, VALIDATED, CRED_OFFERED, COMPLETED, CRED_REVOKED, TERMINATED_BY_*, ERROR, PERM_REVOKED, PERM_SLASHED). */
export enum VtFlowState {
  AwaitingVp = 'AWAITING_VP',
  VrSent = 'VR_SENT',
  AwaitingVr = 'AWAITING_VR',
  IrSent = 'IR_SENT',
  AwaitingIr = 'AWAITING_IR',
  OobPending = 'OOB_PENDING',
  Validating = 'VALIDATING',
  Validated = 'VALIDATED',
  CredOffered = 'CRED_OFFERED',
  Completed = 'COMPLETED',
  CredRevoked = 'CRED_REVOKED',
  TerminatedByValidator = 'TERMINATED_BY_VALIDATOR',
  TerminatedByApplicant = 'TERMINATED_BY_APPLICANT',
  Error = 'ERROR',
  PermRevoked = 'PERM_REVOKED',
  PermSlashed = 'PERM_SLASHED',
}

/** Terminal states; Connection State is implicitly `TERMINATED` for each. */
export const VtFlowTerminalStates: ReadonlySet<VtFlowState> = new Set([
  VtFlowState.TerminatedByValidator,
  VtFlowState.TerminatedByApplicant,
  VtFlowState.Error,
  VtFlowState.PermRevoked,
  VtFlowState.PermSlashed,
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
    sessionUuid: string
    state: VtFlowState
    previousState: VtFlowState | null
  }
}

export interface SendValidationRequestOptions {
  connectionId: string
  sessionUuid?: string
  permId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
}

export interface SendIssuanceRequestOptions {
  connectionId: string
  sessionUuid?: string
  schemaId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
}

export interface OfferCredentialForSessionOptions {
  vtFlowRecordId: string
  credentialFormats: { jsonld: DidCommJsonLdCredentialDetailFormat }
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
