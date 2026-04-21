/** vt-flow Flow State. See `doc/vt-flow-protocol.md` §States. */
export enum VtFlowState {
  /** §5.1 Applicant — waiting for on-chain `start-perm-vp`. */
  AwaitingVp = 'AWAITING_VP',
  /** §5.1 Applicant — VR sent. */
  VrSent = 'VR_SENT',
  /** §5.1 Validator — expecting a VR. */
  AwaitingVr = 'AWAITING_VR',
  /** §5.2 Applicant — IR sent. */
  IrSent = 'IR_SENT',
  /** §5.2 Validator — expecting an IR. */
  AwaitingIr = 'AWAITING_IR',
  /** Applicant completing an OOB step. */
  OobPending = 'OOB_PENDING',
  /** Validator performing off-chain validation. */
  Validating = 'VALIDATING',
  /** §5.1 — `set-perm-vp-validated` on-chain. */
  Validated = 'VALIDATED',
  /** Issue Credential V2 subprotocol in flight. */
  CredOffered = 'CRED_OFFERED',
  /** Credential accepted; connection stays open. */
  Completed = 'COMPLETED',
  /** Validator sent `credential-state-change` with `state=REVOKED`. */
  CredRevoked = 'CRED_REVOKED',
  TerminatedByValidator = 'TERMINATED_BY_VALIDATOR',
  TerminatedByApplicant = 'TERMINATED_BY_APPLICANT',
  /** Unrecoverable protocol error. */
  Error = 'ERROR',
  /** §5.1 — on-chain permission revoked. */
  PermRevoked = 'PERM_REVOKED',
  /** §5.1 — on-chain permission slashed. */
  PermSlashed = 'PERM_SLASHED',
}

/** Terminal states also imply Connection State `TERMINATED`. */
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
