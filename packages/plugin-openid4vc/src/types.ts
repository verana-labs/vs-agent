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

// A type alias, not an interface: only an alias gets the implicit index signature that Credo's `Record<string, unknown>` issuance metadata requires.
export type OpenId4VcOfferIssuanceMetadata = {
  claims: Record<string, unknown>
  ttlSeconds: number
}

export interface OpenId4VcVerifierPolicy {
  id: string
  credentialConfigurationId: string
  requestedClaims: string[]
}

export interface OpenId4VcPluginOptions {
  publicApiBaseUrl: string
  issuer?: {
    displayName: string
    signing: OpenId4VcSigningOptions
    requireWalletAttestation?: boolean
    walletAttestationCertificates?: string[]
    metadataSigner?: 'x5c' | 'did'
    keyAttestationCertificates?: string[]
  }
  verifier?: {
    displayName: string
    signing: OpenId4VcSigningOptions
    requestSigner?: 'x5c' | 'did'
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
