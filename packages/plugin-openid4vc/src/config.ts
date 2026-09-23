import type {
  OpenId4VcConfigurationFile,
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
} from './types'

import { X509Certificate } from '@credo-ts/core'

import { isRecord } from './utils/isRecord'

export const ISSUER_CAPABILITY_ID = 'issuer'
export const VERIFIER_CAPABILITY_ID = 'verifier'

export const OFFER_TTL_SECONDS_MIN = 60
export const OFFER_TTL_SECONDS_MAX = 7_776_000

type LeafRule = (value: unknown, path: string) => void
interface ShapeRule {
  [field: string]: ShapeRule | LeafRule
}

const SIGNING_SHAPE: ShapeRule = {
  configured: { certificateChain: assertNonEmptyStringArray, privateJwk: assertJsonObject },
}

const CONFIGURATION_SHAPE: ShapeRule = {
  issuer: {
    signing: SIGNING_SHAPE,
    walletAttestationCertificates: assertX509Certificates,
    keyAttestationCertificates: assertX509Certificates,
  },
  verifier: { signing: SIGNING_SHAPE },
}

const REQUIRED_FIELDS = new Set([
  'issuer.signing.configured',
  'issuer.signing.configured.certificateChain',
  'issuer.signing.configured.privateJwk',
  'verifier.signing.configured',
  'verifier.signing.configured.certificateChain',
  'verifier.signing.configured.privateJwk',
])

/** [VSA-VTI-CFG-ENV-OID] Validation of the OpenID4VC configuration file. */
export function parseOpenId4VcConfiguration(document: unknown): OpenId4VcConfigurationFile {
  assertShape(document, CONFIGURATION_SHAPE, '')
  return document as OpenId4VcConfigurationFile
}

function assertShape(value: unknown, shape: ShapeRule, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`${path || 'the OpenID4VC configuration'} must be a JSON object`)
  }

  for (const field of Object.keys(shape)) {
    const fieldPath = path ? `${path}.${field}` : field
    if (REQUIRED_FIELDS.has(fieldPath) && !(field in value)) {
      throw new Error(`${fieldPath} is required`)
    }
  }

  for (const [field, child] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${field}` : field
    const rule = Object.prototype.hasOwnProperty.call(shape, field) ? shape[field] : undefined
    if (!rule) {
      throw new Error(`the OpenID4VC configuration contains an unknown field '${fieldPath}'`)
    }
    if (typeof rule === 'function') rule(child, fieldPath)
    else assertShape(child, rule, fieldPath)
  }
}

function assertJsonObject(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`${path} must be a JSON object`)
  }
}

function assertNonEmptyStringArray(value: unknown, path: string): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(item => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error(`${path} must contain non-empty strings`)
  }
}

function assertX509Certificates(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of X.509 certificates`)
  }

  value.forEach((certificate, index) => {
    try {
      if (typeof certificate !== 'string') throw new Error('not a string')
      X509Certificate.fromEncodedCertificate(certificate)
    } catch {
      throw new Error(`${path}[${index}] must be a valid X.509 certificate`)
    }
  })
}

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

function isEmptyClaim(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}
