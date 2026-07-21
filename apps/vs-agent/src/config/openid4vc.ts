import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { readFile } from 'fs/promises'

const OPENID4VC_PLUGIN_PACKAGE = '@verana-labs/vs-agent-plugin-openid4vc'
const OPENID4VC_CONFIG_FIELDS = new Set([
  'issuer',
  'verifier',
  'trust',
  'credentialConfigurations',
  'verifierPolicies',
])

export type OpenId4VcOptions = Record<string, unknown> & { publicApiBaseUrl: string }

type OpenId4VcPluginModule = {
  validateOpenId4VcOptions: (options: OpenId4VcOptions) => void
  OpenId4VcPlugin: (options: OpenId4VcOptions) => VsAgentNestPlugin
}

const importOpenId4VcPlugin = async (): Promise<OpenId4VcPluginModule> =>
  (await import(OPENID4VC_PLUGIN_PACKAGE)) as OpenId4VcPluginModule

export async function loadOpenId4VcOptions(
  configPath: string,
  publicApiBaseUrl: string,
): Promise<OpenId4VcOptions> {
  const pluginModule = await importOpenId4VcPlugin()
  return loadOpenId4VcOptionsWithModule(configPath, publicApiBaseUrl, pluginModule)
}

export async function loadOptionalOpenId4VcPlugin(
  enabledPlugins: string[],
  configPath: string | undefined,
  publicApiBaseUrl: string,
): Promise<VsAgentNestPlugin | undefined> {
  if (!enabledPlugins.includes('openid4vc')) return undefined
  if (!configPath) throw new Error('OID4VC_CONFIG_FILE is required when the OpenID4VC plugin is enabled')

  const pluginModule = await importOpenId4VcPlugin()
  const options = await loadOpenId4VcOptionsWithModule(configPath, publicApiBaseUrl, pluginModule)
  return pluginModule.OpenId4VcPlugin(options)
}

async function loadOpenId4VcOptionsWithModule(
  configPath: string,
  publicApiBaseUrl: string,
  pluginModule: OpenId4VcPluginModule,
): Promise<OpenId4VcOptions> {
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

  const options: OpenId4VcOptions = { ...parsed, publicApiBaseUrl }
  pluginModule.validateOpenId4VcOptions(options)
  return options
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
