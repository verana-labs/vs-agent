/**
 * Role a party plays in a vt-flow session.
 *
 * Roles are perspective-only (never appear on the wire). See
 * `doc/vt-flow-protocol.md` §Roles for the canonical definitions and the
 * valid Applicant / Validator permission pairings referenced from
 * VS-Agent Core §5.1.
 *
 * - `Applicant` — the party requesting a credential. Always initiates the
 *   underlying DIDComm connection and sends the first vt-flow message
 *   (`validation-request` in the §5.1 flow, `issuance-request` in §5.2).
 * - `Validator` — the party authorised to validate and, optionally, issue
 *   the credential. For the §5.1 flow the Validator also performs the
 *   on-chain `set-perm-vp-validated` transition.
 */
export enum VtFlowRole {
  Applicant = 'applicant',
  Validator = 'validator',
}
