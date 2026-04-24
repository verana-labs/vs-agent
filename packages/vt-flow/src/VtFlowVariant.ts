/** Spec v4 (§5.1, §5.2): ValidationProcess (validation-request, GRANTOR/ECOSYSTEM) and DirectIssuance (issuance-request, HOLDER/ISSUER), ensuring type-safe flow handling. */
export enum VtFlowVariant {
  ValidationProcess = 'validation-process',
  DirectIssuance = 'direct-issuance',
}
