import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
  OpenId4VcSigningOptions,
} from './types'

import { isRecord } from './utils/isRecord'

export const ISSUER_CAPABILITY_ID = 'issuer'
export const VERIFIER_CAPABILITY_ID = 'verifier'

export const OFFER_TTL_SECONDS_MIN = 60
export const OFFER_TTL_SECONDS_MAX = 7_776_000

/** [VSA-VTI-CFG-ENV-OID] Validation of the OpenID4VC configuration file. */
export function validateOpenId4VcOptions(options: OpenId4VcPluginOptions): void {
  assertHttpsUrl(options.publicApiBaseUrl, 'publicApiBaseUrl')

  if (options.issuer) {
    assertSigningOptions(options.issuer.signing, 'issuer.signing')

    if (options.issuer.walletAttestationCertificates !== undefined) {
      assertStringArray(options.issuer.walletAttestationCertificates, 'issuer.walletAttestationCertificates')
    }

    if (options.issuer.keyAttestationCertificates !== undefined) {
      assertStringArray(options.issuer.keyAttestationCertificates, 'issuer.keyAttestationCertificates')
    }
  }

  if (options.verifier) {
    assertSigningOptions(options.verifier.signing, 'verifier.signing')
  }
}

export class UnknownCredentialConfigurationError extends Error {}

export function findCredentialConfiguration(
  options: Pick<OpenId4VcPluginOptions, 'credentialConfigurations'>,
  id: string,
): OpenId4VcCredentialConfiguration | undefined {
  return options.credentialConfigurations.find(configuration => configuration.id === id)
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

function assertSigningOptions(signing: OpenId4VcSigningOptions | undefined, field: string): void {
  if (signing === undefined) return
  if (!isRecord(signing)) {
    throw new Error(`${field} must be an object`)
  }

  const { configured } = signing
  if (!isRecord(configured)) {
    throw new Error(`${field}.configured is required`)
  }

  assertNonEmptyStringArray(configured.certificateChain, `${field}.configured.certificateChain`)
  if (!configured.privateJwk || typeof configured.privateJwk !== 'object') {
    throw new Error(`${field}.configured.privateJwk is required`)
  }
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

function isEmptyClaim(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}
