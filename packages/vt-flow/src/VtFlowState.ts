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
