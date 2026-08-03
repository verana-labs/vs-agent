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
    id: string
    displayName: string
    signing: OpenId4VcSigningOptions
    requireWalletAttestation?: boolean
    walletAttestationCertificates?: string[]
    /**
     * How the issuer signs its credential issuer metadata. `x5c` (the default) signs with the
     * certificate chain; `did` signs with the issuer's DID, which is what lets a wallet
     * trust-resolve it against a registry. Credo only accepts this at issuer creation, so an
     * issuer record created under a different value keeps it until the record is recreated.
     */
    metadataSigner?: 'x5c' | 'did'
  }
  verifier?: {
    id: string
    displayName: string
    signing: OpenId4VcSigningOptions
    /**
     * How the verifier identifies itself in the authorization request. `x5c` (the default) yields an
     * `x509_hash:` client_id; `did` yields the verifier's DID, which is what lets a wallet
     * trust-resolve it against a registry instead of against a certificate.
     */
    requestSigner?: 'x5c' | 'did'
  }
  trust?: {
    resolverUrl: string
    timeoutMs: number
    allowedDidWebHosts: string[]
    credentialIssuerCertificates: string[]
    developmentCertificateFingerprints?: string[]
  }
  revocation?: {
    enabled: boolean
    /** Status list capacity in entries; defaults to 131072. */
    size?: number
  }
  credentialConfigurations: OpenId4VcCredentialConfiguration[]
  verifierPolicies: OpenId4VcVerifierPolicy[]
}
