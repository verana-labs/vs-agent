import type { OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'

import { parseOpenId4VcConfiguration } from '@verana-labs/vs-agent-plugin-openid4vc'
import { readFile } from 'fs/promises'

const FETCH_TIMEOUT_MS = 10_000

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

  return { ...parseOpenId4VcConfiguration(parsed), publicApiBaseUrl, credentialConfigurations: [] }
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
