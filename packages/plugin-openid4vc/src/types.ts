import type { Kms, X509Module } from '@credo-ts/core'
import type { OpenId4VcModule } from '@credo-ts/openid4vc'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

export type OpenId4VcVsAgentModules = BaseAgentModules & {
  openId4Vc: OpenId4VcModule<null, null>
  x509: X509Module
}

export type OpenId4VcAgent = VsAgent<OpenId4VcVsAgentModules>

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

export interface OpenId4VcConfigurationFile {
  issuer?: {
    signing?: OpenId4VcSigningOptions
    walletAttestationCertificates?: string[]
    keyAttestationCertificates?: string[]
  }
  verifier?: {
    signing?: OpenId4VcSigningOptions
  }
}

export const OPENID4VC_OPTIONS = 'OPENID4VC_OPTIONS'

export interface OpenId4VcPluginOptions extends OpenId4VcConfigurationFile {
  publicApiBaseUrl: string
  credentialConfigurations: OpenId4VcCredentialConfiguration[]
}
