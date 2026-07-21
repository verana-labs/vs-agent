import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
  OpenId4VcSigningOptions,
  OpenId4VcVerifierPolicy,
} from './types'

const MAX_TTL_SECONDS = 31_536_000
const MIN_TTL_SECONDS = 60
const RESERVED_CREDENTIAL_CLAIMS = new Set(['vct', 'iat', 'exp', 'iss', 'cnf'])

export function validateOpenId4VcOptions(options: OpenId4VcPluginOptions): void {
  assertHttpsUrl(options.publicApiBaseUrl, 'publicApiBaseUrl')

  if (!options.issuer && !options.verifier) {
    throw new Error('OpenID4VC plugin requires an issuer or verifier capability')
  }

  if (options.issuer) {
    assertNonEmptyString(options.issuer.id, 'issuer.id')
    assertNonEmptyString(options.issuer.displayName, 'issuer.displayName')
    assertSigningOptions(options.issuer.signing, 'issuer.signing')

    if (
      options.issuer.requireWalletAttestation &&
      !hasNonEmptyString(options.issuer.walletAttestationCertificates)
    ) {
      throw new Error('issuer.walletAttestationCertificates is required when wallet attestation is enabled')
    }
  }

  if (options.verifier) {
    assertNonEmptyString(options.verifier.id, 'verifier.id')
    assertNonEmptyString(options.verifier.displayName, 'verifier.displayName')
    assertSigningOptions(options.verifier.signing, 'verifier.signing')
    assertTrustOptions(options.trust, true)
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
    const value = input[name]
    if (isEmptyClaim(value)) {
      throw new Error(`claim '${name}' must be non-empty`)
    }
    claims[name] = value
  }

  return claims
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

    if (
      !Number.isInteger(configuration.ttlSeconds) ||
      configuration.ttlSeconds < MIN_TTL_SECONDS ||
      configuration.ttlSeconds > MAX_TTL_SECONDS
    ) {
      throw new Error(
        `${prefix}.ttlSeconds must be an integer between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}`,
      )
    }
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
  if (!Number.isInteger(trust.timeoutMs) || trust.timeoutMs <= 0) {
    throw new Error('trust.timeoutMs must be a positive integer')
  }
  assertStringArray(trust.credentialIssuerCertificates, 'trust.credentialIssuerCertificates')
  if (trust.developmentCertificateFingerprints) {
    assertStringArray(trust.developmentCertificateFingerprints, 'trust.developmentCertificateFingerprints')
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
  try {
    return new URL(value)
  } catch {
    throw new Error(`${field} must be a valid URL`)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEmptyClaim(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}
