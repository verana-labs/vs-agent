export interface VtFlowClaimsConfig {
  organization?: Record<string, unknown>
  service?: Record<string, unknown>
  persona?: Record<string, unknown>
}

export type EcsSchemaKind = keyof VtFlowClaimsConfig

export interface VtFlowSetupOptions {
  claims: VtFlowClaimsConfig
}

export interface ValidateFlowOptions {
  credentialSchemaCredentialId: string
}
