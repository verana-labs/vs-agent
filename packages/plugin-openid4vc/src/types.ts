import type { Kms } from '@credo-ts/core'

export interface OpenId4VcConfiguredSigningMaterial {
  certificateChain: string[]
  privateJwk: Kms.KmsJwkPrivateEc
}

export type OpenId4VcSigningOptions =
  | { configured: OpenId4VcConfiguredSigningMaterial; development?: never }
  | { configured?: never; development: { enabled: true; commonName: string } }

export interface OpenId4VcCredentialConfiguration {
  id: string
  format: 'dc+sd-jwt'
  vct: string
  name: string
  description?: string
  vtjscId: string
  claims: string[]
  disclosureFrame: string[]
}

export interface OpenId4VcVerifierPolicy {
  id: string
  credentialConfigurationId: string
  requestedClaims: string[]
}

export interface OpenId4VcPluginOptions {
  publicApiBaseUrl: string
  issuer?: {
    signing: OpenId4VcSigningOptions
    walletAttestationCertificates?: string[]
    keyAttestationCertificates?: string[]
  }
  verifier?: {
    signing: OpenId4VcSigningOptions
  }
  trust?: {
    resolverUrl: string
    timeoutMs: number
    allowedDidWebHosts: string[]
    credentialIssuerCertificates: string[]
    developmentCertificateFingerprints?: string[]
  }
  credentialConfigurations: OpenId4VcCredentialConfiguration[]
  verifierPolicies: OpenId4VcVerifierPolicy[]
}
