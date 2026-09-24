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

/** [VSA-VTI-CFG-ENV-OID] Validation of the OpenID4VC configuration file. */
export function parseOpenId4VcConfiguration(document: unknown): OpenId4VcConfigurationFile {
  const configuration = assertJsonObject(document, '')
  for (const field of Object.keys(configuration)) {
    if (field === 'issuer') parseIssuer(configuration.issuer, field)
    else if (field === 'verifier') parseVerifier(configuration.verifier, field)
    else throw unknownField(field)
  }

  return document as OpenId4VcConfigurationFile
}

function parseIssuer(value: unknown, path: string): void {
  const issuer = assertJsonObject(value, path)
  for (const field of Object.keys(issuer)) {
    const fieldPath = `${path}.${field}`
    if (field === 'signing') parseSigning(issuer.signing, fieldPath)
    else if (field === 'walletAttestationCertificates' || field === 'keyAttestationCertificates') {
      assertX509Certificates(issuer[field], fieldPath)
    } else throw unknownField(fieldPath)
  }
}

function parseVerifier(value: unknown, path: string): void {
  const verifier = assertJsonObject(value, path)
  for (const field of Object.keys(verifier)) {
    const fieldPath = `${path}.${field}`
    if (field !== 'signing') throw unknownField(fieldPath)
    parseSigning(verifier.signing, fieldPath)
  }
}

function parseSigning(value: unknown, path: string): void {
  const signing = assertJsonObject(value, path)
  const configuredPath = `${path}.configured`
  if (!('configured' in signing)) throw new Error(`${configuredPath} is required`)
  for (const field of Object.keys(signing)) {
    if (field !== 'configured') throw unknownField(`${path}.${field}`)
  }

  const configured = assertJsonObject(signing.configured, configuredPath)
  for (const field of ['certificateChain', 'privateJwk']) {
    if (!(field in configured)) throw new Error(`${configuredPath}.${field} is required`)
  }
  for (const field of Object.keys(configured)) {
    if (field !== 'certificateChain' && field !== 'privateJwk') {
      throw unknownField(`${configuredPath}.${field}`)
    }
  }

  assertNonEmptyStringArray(configured.certificateChain, `${configuredPath}.certificateChain`)
  assertJsonObject(configured.privateJwk, `${configuredPath}.privateJwk`)
}

function unknownField(path: string): Error {
  return new Error(`the OpenID4VC configuration contains an unknown field '${path}'`)
}

function assertJsonObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path || 'the OpenID4VC configuration'} must be a JSON object`)
  }

  return value
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
