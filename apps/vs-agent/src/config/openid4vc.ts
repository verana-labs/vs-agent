import type { OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'

import { validateOpenId4VcOptions } from '@verana-labs/vs-agent-plugin-openid4vc'
import { readFile } from 'fs/promises'

const OPENID4VC_CONFIG_FIELDS = new Set([
  'issuer',
  'verifier',
  'trust',
  'credentialConfigurations',
  'verifierPolicies',
])

export async function readOpenId4VcOptions(
  configPath: string,
  publicApiBaseUrl: string,
): Promise<OpenId4VcPluginOptions> {
  let contents: string
  try {
    contents = await readFile(configPath, 'utf8')
  } catch {
    throw new Error(`Unable to read OpenID4VC configuration file '${configPath}'`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error(`Invalid JSON in OpenID4VC configuration file '${configPath}'`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`OpenID4VC configuration file '${configPath}' must contain a JSON object`)
  }
  if ('publicApiBaseUrl' in parsed) {
    throw new Error(`publicApiBaseUrl must not be set in OpenID4VC configuration file '${configPath}'`)
  }

  const unknownField = Object.keys(parsed).find(field => !OPENID4VC_CONFIG_FIELDS.has(field))
  if (unknownField) {
    throw new Error(
      `OpenID4VC configuration file '${configPath}' contains unknown top-level field '${unknownField}'`,
    )
  }

  const options = { ...parsed, publicApiBaseUrl } as OpenId4VcPluginOptions
  validateOpenId4VcOptions(options)
  return options
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
