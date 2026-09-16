import type { Kms } from '@credo-ts/core'

export interface OpenId4VcConfiguredSigningMaterial {
  certificateChain: string[]
  privateJwk: Kms.KmsJwkPrivateEc
}

export type OpenId4VcSigningOptions =
  | { configured: OpenId4VcConfiguredSigningMaterial; development?: never }
  | { configured?: never; development: { enabled: true; commonName: string } }

/**
 * How one claim is presented to the holder, per language. Published as `claims[].display[]` in
 * the SD-JWT VC type metadata and as `credential_metadata.claims[].display[]` in the OpenID4VCI
 * issuer metadata; the wallets that render claim labels (wwWallet, the EUDI family, Paradym,
 * Procivis One, NL Wallet) read one or the other.
 */
export interface OpenId4VcClaimDisplay {
  /** BCP 47 language tag (`es`, `en-US`). One entry per locale for a given claim. */
  locale: string
  label: string
  description?: string
}

export interface OpenId4VcCredentialConfiguration {
  id: string
  format: 'dc+sd-jwt'
  vct: string
  name: string
  description?: string
  vtjscId: string
  claims: string[]
  /**
   * Labels for configured claims, keyed by claim name. Optional, and optional per claim: a claim
   * without an entry is published with its path only, which label-rendering wallets show as the
   * raw claim name or leave out of the credential details.
   */
  claimDisplay?: Record<string, OpenId4VcClaimDisplay[]>
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
    /**
     * Trust anchors for OpenID4VCI key attestations. A wallet that can only prove possession
     * through an attested key - the EUDI reference wallet is one - sends a `key-attestation+jwt`
     * signed by its wallet provider, and this is what that attestation must chain to. Absent, the
     * `attestation` proof type stays off the issuer record and no attestation proof is accepted.
     */
    keyAttestationCertificates?: string[]
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
  credentialConfigurations: OpenId4VcCredentialConfiguration[]
  verifierPolicies: OpenId4VcVerifierPolicy[]
}
