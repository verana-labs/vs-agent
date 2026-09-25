import { VtFlowState } from '../types'

/** Wire `description.code` values for vt-flow problem-reports (see spec Error Codes). */
export enum VtFlowErrorCode {
  OrRequired = 'vt-flow.or-required',
  IrRequired = 'vt-flow.ir-required',
  UnsupportedMessage = 'vt-flow.unsupported-message',
  InvalidParticipantId = 'vt-flow.invalid-participant-id',
  InvalidSchemaId = 'vt-flow.invalid-schema-id',
  InvalidAgentParticipantId = 'vt-flow.invalid-agent-participant-id',
  InvalidWalletAgentParticipantId = 'vt-flow.invalid-wallet-agent-participant-id',
  InvalidClaims = 'vt-flow.invalid-claims',
  InvalidParticipantSessionId = 'vt-flow.invalid-participant-session-id',
  NotAVerifiableService = 'vt-flow.not-a-verifiable-service',
  ValidationFailed = 'vt-flow.validation-failed',
  ValidationRefused = 'vt-flow.validation-refused',
  OobExpired = 'vt-flow.oob-expired',
  SessionTerminated = 'vt-flow.session-terminated',
  ParticipantRevoked = 'vt-flow.participant-revoked',
  ParticipantSlashed = 'vt-flow.participant-slashed',
  InternalError = 'vt-flow.internal-error',
}

/** RFC 0035 `who_retries`; wire form is lowercase. */
export type WhoRetries = 'you' | 'me' | 'both' | 'none'

/** RFC 0035 `impact`; same casing note as `WhoRetries`. */
export type ErrorImpact = 'message' | 'thread' | 'connection'

/** Flow State the receiving party moves to; `terminated-by-sender` resolves to `TERMINATED_BY_VALIDATOR` or `TERMINATED_BY_APPLICANT` from the sender's role. */
export type VtFlowErrorFlowState =
  | VtFlowState
  | 'unchanged'
  | 'terminated-by-sender'
  | 'unchanged-when-you'
  | 'error-when-fatal'

/** Per-code metadata mirroring the spec's Error Codes table. */
export interface VtFlowErrorInfo {
  whoRetries: WhoRetries
  impact: ErrorImpact
  flowState: VtFlowErrorFlowState
}

export const VT_FLOW_ERROR_INFO: Readonly<Record<VtFlowErrorCode, VtFlowErrorInfo>> = {
  [VtFlowErrorCode.OrRequired]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.IrRequired]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.UnsupportedMessage]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: VtFlowState.Error,
  },
  [VtFlowErrorCode.InvalidParticipantId]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.InvalidSchemaId]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.InvalidAgentParticipantId]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.InvalidWalletAgentParticipantId]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.InvalidClaims]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.InvalidParticipantSessionId]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged',
  },
  [VtFlowErrorCode.NotAVerifiableService]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: VtFlowState.Error,
  },
  [VtFlowErrorCode.ValidationFailed]: {
    whoRetries: 'you',
    impact: 'thread',
    flowState: 'unchanged-when-you',
  },
  [VtFlowErrorCode.ValidationRefused]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: VtFlowState.TerminatedByValidator,
  },
  [VtFlowErrorCode.OobExpired]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: VtFlowState.TerminatedByValidator,
  },
  [VtFlowErrorCode.SessionTerminated]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: 'terminated-by-sender',
  },
  [VtFlowErrorCode.ParticipantRevoked]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: VtFlowState.ParticipantRevoked,
  },
  [VtFlowErrorCode.ParticipantSlashed]: {
    whoRetries: 'none',
    impact: 'connection',
    flowState: VtFlowState.ParticipantSlashed,
  },
  [VtFlowErrorCode.InternalError]: {
    whoRetries: 'none',
    impact: 'thread',
    flowState: 'error-when-fatal',
  },
}

export function isVtFlowErrorCode(code: string): code is VtFlowErrorCode {
  return (Object.values(VtFlowErrorCode) as string[]).includes(code)
}
