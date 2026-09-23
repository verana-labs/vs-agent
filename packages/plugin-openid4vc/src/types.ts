import type { Kms } from '@credo-ts/core'

export interface OpenId4VcConfiguredSigningMaterial {
  certificateChain: string[]
  privateJwk: Kms.KmsJwkPrivateEc
}

export interface OpenId4VcSigningOptions {
  configured: OpenId4VcConfiguredSigningMaterial
}

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

export interface OpenId4VcPluginOptions {
  publicApiBaseUrl: string
  issuer?: {
    signing?: OpenId4VcSigningOptions
    walletAttestationCertificates?: string[]
    keyAttestationCertificates?: string[]
  }
  verifier?: {
    signing?: OpenId4VcSigningOptions
  }
  trust?: {
    resolverUrl: string
    timeoutMs: number
    allowedDidWebHosts: string[]
    credentialIssuerCertificates: string[]
    developmentCertificateFingerprints?: string[]
  }
  credentialConfigurations: OpenId4VcCredentialConfiguration[]
}
