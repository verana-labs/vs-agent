/**
 * Wire `description.code` values for vt-flow problem-reports.
 * See `doc/vt-flow-protocol.md` §Error Codes.
 */
export enum VtFlowErrorCode {
  /** Expected `validation-request`. */
  VrRequired = 'vt-flow.vr-required',
  /** Expected `issuance-request`. */
  IrRequired = 'vt-flow.ir-required',
  /** Message type not supported in the current state. */
  UnsupportedMessage = 'vt-flow.unsupported-message',
  /** `perm_id` invalid, unrelated to the Validator, or in the wrong `vp_state`. */
  InvalidPermId = 'vt-flow.invalid-perm-id',
  /** `schema_id` does not exist or is not supported. */
  InvalidSchemaId = 'vt-flow.invalid-schema-id',
  InvalidAgentPermId = 'vt-flow.invalid-agent-perm-id',
  InvalidWalletAgentPermId = 'vt-flow.invalid-wallet-agent-perm-id',
  InvalidClaims = 'vt-flow.invalid-claims',
  InvalidSessionUuid = 'vt-flow.invalid-session-uuid',
  /** Applicant's DID does not satisfy VS-CONN-VS. */
  NotAVerifiableService = 'vt-flow.not-a-verifiable-service',
  /** Off-chain documentation validation failed. */
  ValidationFailed = 'vt-flow.validation-failed',
  OobExpired = 'vt-flow.oob-expired',
  SessionTerminated = 'vt-flow.session-terminated',
  InternalError = 'vt-flow.internal-error',
}

/** RFC 0035 `who_retries`. Wire form is lowercase; Credo emits UPPER-CASE. */
export type WhoRetries = 'you' | 'me' | 'both' | 'none'

/** RFC 0035 `impact`. Same casing note as {@link WhoRetries}. */
export type ErrorImpact = 'message' | 'thread' | 'connection'

export interface VtFlowErrorInfo {
  whoRetries: WhoRetries
  impact: ErrorImpact
  /** `false` when `impact === 'connection'` or `whoRetries === 'none'`. */
  retryable: boolean
}

/** Metadata per error code. Mirrors the spec's Error Codes table. */
export const VT_FLOW_ERROR_INFO: Readonly<Record<VtFlowErrorCode, VtFlowErrorInfo>> = {
  [VtFlowErrorCode.VrRequired]: { whoRetries: 'you', impact: 'thread', retryable: true },
  [VtFlowErrorCode.IrRequired]: { whoRetries: 'you', impact: 'thread', retryable: true },
  [VtFlowErrorCode.UnsupportedMessage]: {
    whoRetries: 'none',
    impact: 'connection',
    retryable: false,
  },
  [VtFlowErrorCode.InvalidPermId]: { whoRetries: 'you', impact: 'thread', retryable: true },
  [VtFlowErrorCode.InvalidSchemaId]: { whoRetries: 'you', impact: 'thread', retryable: true },
  [VtFlowErrorCode.InvalidAgentPermId]: {
    whoRetries: 'you',
    impact: 'thread',
    retryable: true,
  },
  [VtFlowErrorCode.InvalidWalletAgentPermId]: {
    whoRetries: 'you',
    impact: 'thread',
    retryable: true,
  },
  [VtFlowErrorCode.InvalidClaims]: { whoRetries: 'you', impact: 'thread', retryable: true },
  [VtFlowErrorCode.InvalidSessionUuid]: {
    whoRetries: 'you',
    impact: 'thread',
    retryable: true,
  },
  [VtFlowErrorCode.NotAVerifiableService]: {
    whoRetries: 'none',
    impact: 'connection',
    retryable: false,
  },
  [VtFlowErrorCode.ValidationFailed]: {
    whoRetries: 'you',
    impact: 'thread',
    retryable: true,
  },
  [VtFlowErrorCode.OobExpired]: { whoRetries: 'you', impact: 'thread', retryable: true },
  [VtFlowErrorCode.SessionTerminated]: {
    whoRetries: 'none',
    impact: 'thread',
    retryable: false,
  },
  // Spec says "varies"; default to non-retryable so fall-through stays safe.
  [VtFlowErrorCode.InternalError]: { whoRetries: 'none', impact: 'thread', retryable: false },
}

export function isVtFlowErrorCode(code: string): code is VtFlowErrorCode {
  return (Object.values(VtFlowErrorCode) as string[]).includes(code)
}
