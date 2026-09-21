import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
  OpenId4VcSigningOptions,
  OpenId4VcVerifierPolicy,
} from './types'

import { X509Certificate, X509KeyUsage } from '@credo-ts/core'

import { assertCertificateChainUsable } from './services/CertificateService'
import { certificateFingerprint } from './trust/CertificateTrust'
import { MAX_DID_RESOLUTION_TIMEOUT_MS } from './trust/keyBinding'
import { isRecord } from './utils/isRecord'

export const ISSUER_CAPABILITY_ID = 'issuer'
export const VERIFIER_CAPABILITY_ID = 'verifier'

export const OFFER_TTL_SECONDS_MIN = 60
export const OFFER_TTL_SECONDS_MAX = 7_776_000

const RESERVED_CREDENTIAL_CLAIMS = new Set([
  'vct',
  'vct#integrity',
  'iat',
  'exp',
  'nbf',
  'iss',
  'cnf',
  'status',
])

/** [VSA-VTI-CFG-ENV-OID] Validation of the OpenID4VC configuration file. */
export function validateOpenId4VcOptions(options: OpenId4VcPluginOptions): void {
  assertHttpsUrl(options.publicApiBaseUrl, 'publicApiBaseUrl')

  if (!options.issuer && !options.verifier) {
    throw new Error('OpenID4VC plugin requires an issuer or verifier capability')
  }

  if (options.issuer) {
    assertNonEmptyString(options.issuer.displayName, 'issuer.displayName')
    assertSigningOptions(options.issuer.signing, 'issuer.signing')

    if (
      options.issuer.requireWalletAttestation &&
      !hasNonEmptyString(options.issuer.walletAttestationCertificates)
    ) {
      throw new Error('issuer.walletAttestationCertificates is required when wallet attestation is enabled')
    }

    if (options.issuer.keyAttestationCertificates !== undefined) {
      assertStringArray(options.issuer.keyAttestationCertificates, 'issuer.keyAttestationCertificates')
    }

    if (options.issuer.metadataSigner !== undefined) {
      assertSignerMode(options.issuer.metadataSigner, 'issuer.metadataSigner')
    }
  }

  if (options.verifier) {
    assertNonEmptyString(options.verifier.displayName, 'verifier.displayName')
    assertSigningOptions(options.verifier.signing, 'verifier.signing')
    assertTrustOptions(options.trust, true)

    if (options.verifier.requestSigner !== undefined) {
      assertSignerMode(options.verifier.requestSigner, 'verifier.requestSigner')
    }
  } else if (options.trust) {
    assertTrustOptions(options.trust, false)
  }

  assertCredentialConfigurations(options.credentialConfigurations)
  assertVerifierPolicies(options.verifierPolicies, options.credentialConfigurations)
}

export function findCredentialConfiguration(
  options: Pick<OpenId4VcPluginOptions, 'credentialConfigurations'>,
  id: string,
): OpenId4VcCredentialConfiguration | undefined {
  return options.credentialConfigurations.find(configuration => configuration.id === id)
}

export function findVerifierPolicy(
  options: Pick<OpenId4VcPluginOptions, 'verifierPolicies'>,
  id: string,
): OpenId4VcVerifierPolicy | undefined {
  return options.verifierPolicies.find(policy => policy.id === id)
}

export function parseOfferClaims(
  configuration: OpenId4VcCredentialConfiguration,
  input: unknown,
): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error('claims must be an object')
  }

  for (const name of Object.keys(input)) {
    if (!configuration.claims.includes(name)) {
      throw new Error(`unknown claim '${name}'`)
    }
  }

  const claims: Record<string, unknown> = {}
  for (const name of configuration.claims) {
    if (!(name in input)) continue
    const value = input[name]
    if (isEmptyClaim(value)) {
      throw new Error(`claim '${name}' must be non-empty`)
    }
    claims[name] = value
  }

  if (Object.keys(claims).length === 0) {
    throw new Error('claims must include at least one configured claim')
  }

  return claims
}

export function parseOfferTtlSeconds(input: unknown): number {
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < OFFER_TTL_SECONDS_MIN ||
    input > OFFER_TTL_SECONDS_MAX
  ) {
    throw new Error(
      `ttlSeconds must be an integer between ${OFFER_TTL_SECONDS_MIN} and ${OFFER_TTL_SECONDS_MAX}`,
    )
  }

  return input
}

export function parseOfferIssuanceMetadata(
  configuration: OpenId4VcCredentialConfiguration,
  input: unknown,
): { claims: Record<string, unknown>; ttlSeconds: number } {
  if (!isRecord(input)) {
    throw new Error('issuance metadata must be an object')
  }

  return {
    claims: parseOfferClaims(configuration, input.claims),
    ttlSeconds: parseOfferTtlSeconds(input.ttlSeconds),
  }
}

function assertCredentialConfigurations(configurations: OpenId4VcCredentialConfiguration[]): void {
  if (!Array.isArray(configurations)) {
    throw new Error('credentialConfigurations must be an array')
  }

  assertUniqueNonEmptyIds(configurations, 'credential configuration')

  for (const configuration of configurations) {
    const prefix = `credential configuration '${configuration.id}'`
    if (configuration.format !== 'dc+sd-jwt') {
      throw new Error(`${prefix}: format must be 'dc+sd-jwt'`)
    }
    assertHttpUrl(configuration.vct, `${prefix}.vct`)
    assertHttpUrl(configuration.vtjscId, `${prefix}.vtjscId`)
    assertNonEmptyString(configuration.name, `${prefix}.name`)
    assertNonEmptyUniqueStrings(configuration.claims, `${prefix}.claims`)
    const reservedClaim = configuration.claims.find(claim => RESERVED_CREDENTIAL_CLAIMS.has(claim))
    if (reservedClaim) {
      throw new Error(`${prefix}.claims contains reserved claim '${reservedClaim}'`)
    }
    assertSubset(configuration.disclosureFrame, configuration.claims, `${prefix}.disclosureFrame`)
  }
}

function assertVerifierPolicies(
  policies: OpenId4VcVerifierPolicy[],
  configurations: OpenId4VcCredentialConfiguration[],
): void {
  if (!Array.isArray(policies)) {
    throw new Error('verifierPolicies must be an array')
  }

  assertUniqueNonEmptyIds(policies, 'verifier policy')

  for (const policy of policies) {
    const configuration = configurations.find(item => item.id === policy.credentialConfigurationId)
    if (!configuration) {
      throw new Error(
        `verifier policy '${policy.id}': unknown credentialConfigurationId '${policy.credentialConfigurationId}'`,
      )
    }
    assertSubset(
      policy.requestedClaims,
      configuration.claims,
      `verifier policy '${policy.id}'.requestedClaims`,
    )
  }
}

function assertTrustOptions(trust: OpenId4VcPluginOptions['trust'], requiresAnchor: boolean): void {
  if (!trust) {
    if (requiresAnchor) throw new Error('verifier requires trust configuration')
    return
  }

  assertHttpsUrl(trust.resolverUrl, 'trust.resolverUrl')
  if (
    !Number.isInteger(trust.timeoutMs) ||
    trust.timeoutMs <= 0 ||
    trust.timeoutMs > MAX_DID_RESOLUTION_TIMEOUT_MS
  ) {
    throw new Error(
      `trust.timeoutMs must be a positive integer no greater than ${MAX_DID_RESOLUTION_TIMEOUT_MS}`,
    )
  }
  assertNonEmptyUniqueStrings(trust.allowedDidWebHosts, 'trust.allowedDidWebHosts')
  trust.allowedDidWebHosts.forEach((host, index) =>
    assertDidWebHost(host, `trust.allowedDidWebHosts[${index}]`),
  )
  assertStringArray(trust.credentialIssuerCertificates, 'trust.credentialIssuerCertificates')
  assertCredentialIssuerTrustAnchors(trust.credentialIssuerCertificates)
  if (trust.developmentCertificateFingerprints) {
    assertStringArray(trust.developmentCertificateFingerprints, 'trust.developmentCertificateFingerprints')
    if (
      new Set(trust.developmentCertificateFingerprints).size !==
      trust.developmentCertificateFingerprints.length
    ) {
      throw new Error('trust.developmentCertificateFingerprints must not contain duplicates')
    }
    if (
      trust.developmentCertificateFingerprints.some(fingerprint => !/^SHA256:[0-9a-f]{64}$/.test(fingerprint))
    ) {
      throw new Error(
        'trust.developmentCertificateFingerprints must use SHA256 followed by 64 lowercase hexadecimal characters',
      )
    }
  }

  if (
    requiresAnchor &&
    !hasNonEmptyString(trust.credentialIssuerCertificates) &&
    !hasNonEmptyString(trust.developmentCertificateFingerprints)
  ) {
    throw new Error(
      'verifier trust requires credentialIssuerCertificates or developmentCertificateFingerprints',
    )
  }
}

function assertSignerMode(value: unknown, field: string): void {
  if (value !== 'x5c' && value !== 'did') {
    throw new Error(`${field} must be 'x5c' or 'did'`)
  }
}

function assertSigningOptions(signing: OpenId4VcSigningOptions, field: string): void {
  const rawSigning = signing as unknown as Record<string, unknown>
  const hasConfigured = rawSigning.configured !== undefined
  const hasDevelopment = rawSigning.development !== undefined

  if (hasConfigured === hasDevelopment) {
    throw new Error(`${field} must configure exactly one signing mode`)
  }

  if (hasConfigured) {
    const configured = rawSigning.configured as { certificateChain?: unknown; privateJwk?: unknown }
    assertNonEmptyStringArray(configured.certificateChain, `${field}.configured.certificateChain`)
    if (!configured.privateJwk || typeof configured.privateJwk !== 'object') {
      throw new Error(`${field}.configured.privateJwk is required`)
    }
    return
  }

  const development = rawSigning.development as { enabled?: unknown; commonName?: unknown }
  if (development.enabled !== true) {
    throw new Error(`${field}.development.enabled must be true`)
  }
  assertNonEmptyString(development.commonName, `${field}.development.commonName`)
}

function assertHttpsUrl(value: string, field: string): void {
  const url = parseUrl(value, field)
  if (process.env.NODE_ENV !== 'test' && url.protocol !== 'https:') {
    throw new Error(`${field} must use HTTPS outside test mode`)
  }
  if (process.env.NODE_ENV === 'test' && url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${field} must use HTTP(S)`)
  }
}

function assertHttpUrl(value: string, field: string): void {
  const url = parseUrl(value, field)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${field} must use HTTP(S)`)
  }
}

function parseUrl(value: string, field: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${field} must be a valid URL`)
  }

  if (url.username || url.password) {
    throw new Error(`${field} must not include credentials`)
  }
  return url
}

function assertCredentialIssuerTrustAnchors(encodedCertificates: string[]): void {
  const fingerprints = new Set<string>()

  encodedCertificates.forEach((encodedCertificate, index) => {
    let certificate: X509Certificate
    try {
      certificate = X509Certificate.fromEncodedCertificate(encodedCertificate)
    } catch {
      throw new Error(`trust.credentialIssuerCertificates[${index}] must be a valid X.509 certificate`)
    }

    assertCertificateChainUsable([certificate])
    if (!certificate.isCertificateAuthority || !certificate.keyUsage?.includes(X509KeyUsage.KeyCertSign)) {
      throw new Error(
        `trust.credentialIssuerCertificates[${index}] must be a CA trust anchor with keyCertSign usage`,
      )
    }
    if (certificate.subject !== certificate.issuer) {
      throw new Error(`trust.credentialIssuerCertificates[${index}] must be a self-issued root trust anchor`)
    }

    const fingerprint = certificateFingerprint(certificate)
    if (fingerprints.has(fingerprint)) {
      throw new Error('trust.credentialIssuerCertificates contains a duplicate credential issuer certificate')
    }
    fingerprints.add(fingerprint)
  })
}

function assertDidWebHost(value: string, field: string): void {
  try {
    const url = new URL(`https://${value}`)
    if (
      url.username ||
      url.password ||
      !url.hostname ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.host.toLowerCase() !== value
    ) {
      throw new Error()
    }
  } catch {
    throw new Error(`${field} must be an exact lowercase host with an optional port`)
  }
}

function assertUniqueNonEmptyIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    assertNonEmptyString(item.id, `${label} ID`)
    if (ids.has(item.id)) {
      throw new Error(`duplicate ${label} ID '${item.id}'`)
    }
    ids.add(item.id)
  }
}

function assertNonEmptyUniqueStrings(values: string[], field: string): void {
  assertNonEmptyStringArray(values, field)
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} must not contain duplicates`)
  }
}

function assertNonEmptyStringArray(value: unknown, field: string): asserts value is string[] {
  assertStringArray(value, field)
  if (value.length === 0) {
    throw new Error(`${field} must contain non-empty strings`)
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must contain non-empty strings`)
  }
}

function assertSubset(values: string[], allowedValues: string[], field: string): void {
  if (!Array.isArray(values) || values.some(value => !allowedValues.includes(value))) {
    throw new Error(`${field} must be a subset of configured claims`)
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function hasNonEmptyString(value: unknown): boolean {
  return Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim())
}

function isEmptyClaim(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}
