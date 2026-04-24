/** Wire `description.code` values for vt-flow problem-reports (see spec §Error Codes). */
export enum VtFlowErrorCode {
  VrRequired = 'vt-flow.vr-required',
  IrRequired = 'vt-flow.ir-required',
  UnsupportedMessage = 'vt-flow.unsupported-message',
  InvalidPermId = 'vt-flow.invalid-perm-id',
  InvalidSchemaId = 'vt-flow.invalid-schema-id',
  InvalidAgentPermId = 'vt-flow.invalid-agent-perm-id',
  InvalidWalletAgentPermId = 'vt-flow.invalid-wallet-agent-perm-id',
  InvalidClaims = 'vt-flow.invalid-claims',
  InvalidSessionUuid = 'vt-flow.invalid-session-uuid',
  NotAVerifiableService = 'vt-flow.not-a-verifiable-service',
  ValidationFailed = 'vt-flow.validation-failed',
  OobExpired = 'vt-flow.oob-expired',
  SessionTerminated = 'vt-flow.session-terminated',
  InternalError = 'vt-flow.internal-error',
}

/** RFC 0035 `who_retries`; wire form is lowercase but Credo emits UPPER-CASE on the wire. */
export type WhoRetries = 'you' | 'me' | 'both' | 'none'

/** RFC 0035 `impact`; same casing note as `WhoRetries`. */
export type ErrorImpact = 'message' | 'thread' | 'connection'

/** Per-code metadata mirroring the spec's Error Codes table; `retryable` is false when impact is `connection` or `whoRetries` is `none`. */
export interface VtFlowErrorInfo {
  whoRetries: WhoRetries
  impact: ErrorImpact
  retryable: boolean
}

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
  [VtFlowErrorCode.InternalError]: { whoRetries: 'none', impact: 'thread', retryable: false },
}

export function isVtFlowErrorCode(code: string): code is VtFlowErrorCode {
  return (Object.values(VtFlowErrorCode) as string[]).includes(code)
}
