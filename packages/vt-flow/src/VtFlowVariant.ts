export enum VtFlowVariant {
  /** §5.1 — Schema management mode `GRANTOR` or `ECOSYSTEM`; opened by `validation-request`. */
  ValidationProcess = 'validation-process',
  /** §5.2 — Direct issuance (HOLDER/ISSUER); opened by `issuance-request`. */
  DirectIssuance = 'direct-issuance',
}
