import type { TrustClient } from '../trust/TrustClient'
import type { TrustVerdict } from '../trust/types'
import type { OpenId4VcPluginOptions } from '../types'
import type { SdJwtVc, X509Certificate } from '@credo-ts/core'
import type { OpenId4VpVerifiedAuthorizationResponse } from '@credo-ts/openid4vc'

import { ClaimFormat } from '@credo-ts/core'

import { findCredentialConfiguration } from '../config'
import { blockingBindingVerdict, verifyKeyBoundToDid, type DidResolverAgent } from '../trust/keyBinding'
import { isRecord } from '../utils/isRecord'

import { didFromValidatedCertificate } from './CertificateService'
import { matchVerifierPolicy } from './presentationRequest'

export interface OpenId4VcVerifiedCredentialResult {
  vct: string
  disclosedClaims: Record<string, unknown>
}

export type PresentationDecision = {
  cryptographicVerified: boolean
  accepted: boolean
  trust?: TrustVerdict
  credential?: OpenId4VcVerifiedCredentialResult
}

/** Trust decision of [VSA-ADM-OID-PR]. */
export async function decidePresentation(input: {
  agent: DidResolverAgent
  options: Pick<OpenId4VcPluginOptions, 'credentialConfigurations' | 'verifierPolicies'>
  trust: NonNullable<OpenId4VcPluginOptions['trust']>
  trustClient: Pick<TrustClient, 'verdictFor'>
  verified: OpenId4VpVerifiedAuthorizationResponse
}): Promise<PresentationDecision> {
  const { agent, options, trust, trustClient, verified } = input

  const policy = matchVerifierPolicy(options, verified)
  if (!policy) return blocked(null, null, 'unbound')

  const configuration = findCredentialConfiguration(options, policy.credentialConfigurationId)
  if (!configuration) return blocked(null, null, 'unbound')

  const presentation =
    verified.dcql?.presentations[configuration.id]?.[0] ?? verified.presentationExchange?.presentations[0]
  if (!isX5cSdJwtDcPresentation(presentation)) return blocked(null, configuration.vtjscId, 'unbound')

  const disclosedClaims = configuredDisclosedClaims(presentation.prettyClaims, policy.requestedClaims)
  if (presentation.prettyClaims.vct !== configuration.vct || !disclosedClaims) {
    return blocked(null, configuration.vtjscId, 'unbound')
  }

  const issuerCertificate = presentation.issuer.x5c[0]
  let issuerDid: string
  let issuerPublicJwk: unknown
  try {
    issuerDid = didFromValidatedCertificate(issuerCertificate)
    issuerPublicJwk = issuerCertificate.publicJwk.toJson()
  } catch {
    return blocked(null, configuration.vtjscId, 'unbound')
  }

  const credential = { vct: configuration.vct, disclosedClaims }
  const binding = await verifyKeyBoundToDid(agent, issuerDid, issuerPublicJwk, ['assertionMethod'], {
    allowedWebHosts: trust.allowedDidWebHosts,
    timeoutMs: trust.timeoutMs,
  })
  if (binding !== 'bound') {
    return {
      cryptographicVerified: true,
      accepted: false,
      trust: blockingBindingVerdict(issuerDid, configuration.vtjscId, binding),
      credential,
    }
  }

  const verdict = await trustClient.verdictFor('issuer', issuerDid, configuration.vtjscId)
  return {
    cryptographicVerified: true,
    accepted: verdict.verdict === 'TRUSTED_AUTHORIZED',
    trust: verdict,
    credential,
  }
}

export function assertCredentialExpires(credential: unknown): void {
  if (!isRecord(credential) || credential.claimFormat !== ClaimFormat.SdJwtDc) return
  if (!isRecord(credential.payload) || typeof credential.payload.exp !== 'number') {
    throw new Error("the presented SD-JWT VC carries no numeric 'exp' claim")
  }
}

function blocked(
  did: string | null,
  vtjscId: string | null,
  binding: 'unbound' | 'unresolvable',
): PresentationDecision {
  return {
    cryptographicVerified: true,
    accepted: false,
    trust: blockingBindingVerdict(did, vtjscId, binding),
  }
}

type X5cSdJwtDcPresentation = Pick<SdJwtVc, 'claimFormat' | 'prettyClaims'> & {
  issuer: { method: 'x5c'; x5c: [X509Certificate, ...X509Certificate[]] }
}

function isX5cSdJwtDcPresentation(value: unknown): value is X5cSdJwtDcPresentation {
  if (!isRecord(value) || value.claimFormat !== ClaimFormat.SdJwtDc || !isRecord(value.prettyClaims)) {
    return false
  }
  if (!isRecord(value.issuer) || value.issuer.method !== 'x5c' || !Array.isArray(value.issuer.x5c)) {
    return false
  }

  const leaf: unknown = value.issuer.x5c[0]
  return (
    isRecord(leaf) &&
    Array.isArray(leaf.sanUriNames) &&
    isRecord(leaf.publicJwk) &&
    typeof leaf.publicJwk.toJson === 'function'
  )
}

function configuredDisclosedClaims(
  claims: Record<string, unknown>,
  requestedClaims: string[],
): Record<string, unknown> | undefined {
  const disclosedClaims: Record<string, unknown> = {}
  for (const name of requestedClaims) {
    if (!Object.prototype.hasOwnProperty.call(claims, name)) return undefined
    disclosedClaims[name] = claims[name]
  }
  return disclosedClaims
}
