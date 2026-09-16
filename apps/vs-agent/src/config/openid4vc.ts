import type { OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'

import { validateOpenId4VcOptions } from '@verana-labs/vs-agent-plugin-openid4vc'
import { readFile } from 'fs/promises'

const FETCH_TIMEOUT_MS = 10_000

const OPENID4VC_CONFIG_FIELDS = new Set([
  'issuer',
  'verifier',
  'trust',
  'credentialConfigurations',
  'verifierPolicies',
])

const OPENID4VC_ISSUER_FIELDS = new Set([
  'displayName',
  'signing',
  'requireWalletAttestation',
  'walletAttestationCertificates',
  'keyAttestationCertificates',
  'metadataSigner',
])

const OPENID4VC_VERIFIER_FIELDS = new Set(['displayName', 'signing', 'requestSigner'])

export async function readOpenId4VcOptions(
  location: string,
  publicApiBaseUrl: string,
): Promise<OpenId4VcPluginOptions> {
  const url = parseAbsoluteUrl(location)
  const name = url ? `${url.protocol}//${url.host}${url.pathname}` : location
  const contents = url ? await fetchConfiguration(url, name) : await readConfiguration(location)

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error(`Invalid JSON in OpenID4VC configuration file '${name}'`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`OpenID4VC configuration file '${name}' must contain a JSON object`)
  }
  if ('publicApiBaseUrl' in parsed) {
    throw new Error(`publicApiBaseUrl must not be set in OpenID4VC configuration file '${name}'`)
  }

  const unknownField = Object.keys(parsed).find(field => !OPENID4VC_CONFIG_FIELDS.has(field))
  if (unknownField) {
    throw new Error(
      `OpenID4VC configuration file '${name}' contains unknown top-level field '${unknownField}'`,
    )
  }

  assertKnownFields(parsed.issuer, OPENID4VC_ISSUER_FIELDS, 'issuer', name)
  assertKnownFields(parsed.verifier, OPENID4VC_VERIFIER_FIELDS, 'verifier', name)

  const options = { ...parsed, publicApiBaseUrl } as OpenId4VcPluginOptions
  validateOpenId4VcOptions(options)
  return options
}

function assertKnownFields(value: unknown, allowed: Set<string>, path: string, name: string): void {
  if (!isRecord(value)) return

  const unknownField = Object.keys(value).find(field => !allowed.has(field))
  if (unknownField) {
    throw new Error(`OpenID4VC configuration file '${name}' contains unknown field '${path}.${unknownField}'`)
  }
}

async function readConfiguration(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new Error(`Unable to read OpenID4VC configuration file '${path}'`)
  }
}

async function fetchConfiguration(url: URL, name: string): Promise<string> {
  if (url.protocol !== 'https:') {
    throw new Error(`OpenID4VC configuration location '${name}' must use https`)
  }

  let response: Response
  try {
    response = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch {
    throw new Error(`Unable to read OpenID4VC configuration file '${name}'`)
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new Error(
      `OpenID4VC configuration location '${name}' answered with a redirect, which the agent does not follow`,
    )
  }
  if (!response.ok) {
    throw new Error(`Unable to read OpenID4VC configuration file '${name}' (HTTP ${response.status})`)
  }

  try {
    return await response.text()
  } catch {
    throw new Error(`Unable to read OpenID4VC configuration file '${name}'`)
  }
}

function parseAbsoluteUrl(location: string): URL | undefined {
  try {
    return new URL(location)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
