export enum ECS {
  SERVICE = 'ecs-service',
  ORG = 'ecs-org',
  PERSONA = 'ecs-persona',
  USER_AGENT = 'ecs-user-agent',
  BADGE = 'ecs-badge',
}

const DEFAULT_CHAIN_INDEXERS: Record<string, string> = {
  'vna-testnet-1': 'https://idx.testnet.verana.network',
  'vna-devnet-1': 'https://idx.devnet.verana.network',
}

const indexerByChain = new Map<string, string>(Object.entries(DEFAULT_CHAIN_INDEXERS))

/**
 * Registers the indexer base URL that serves schema references for a given chain id.
 * Entries override the built-in defaults, so an agent connected to any chain can
 * dereference `vpr:verana:<chain>:cs:<id>` references through its own indexer.
 */
export function configureChainIndexers(entries: Record<string, string | undefined>): void {
  for (const [chainId, baseUrl] of Object.entries(entries)) {
    if (!chainId || !baseUrl) continue
    indexerByChain.set(chainId, baseUrl.replace(/\/+$/, ''))
  }
}

/**
 * Resolves a schema reference to a fetchable URL. VPR URIs are mapped to the indexer
 * registered for their chain; any other input (e.g. an HTTPS URL) is returned as is.
 *
 * @throws Error if the input is a VPR URI that cannot be mapped to an indexer URL.
 */
export function mapToEcosystem(input: string): string {
  if (!input.startsWith('vpr:verana:')) return input

  const ref = input.match(/^vpr:verana:([^:/]+):cs:(\d+)$/)
  if (!ref) throw new Error(`Malformed VPR schema reference "${input}"`)

  const base = indexerByChain.get(ref[1])
  if (!base) {
    throw new Error(`No indexer configured for chain "${ref[1]}" needed to resolve "${input}"`)
  }
  return `${base}/v4/credential-schema/js/${ref[2]}`
}

// v4 spec [ECS-EC] reference digests
export const ECS_SCHEMA_DIGESTS: Record<ECS, string> = {
  [ECS.SERVICE]: 'sha384-0v+BAFGpnBX/RVqH9dUlMglxMrD4AKy4qUtb1lMN4iW9I2gO7XjcUfmGOf0oInP3',
  [ECS.ORG]: 'sha384-UPn4TDqS1nMBAN3FyMzTAZOWp99zBjBD69OjpbhwOKZj7iOrS5qPwJ2SArRz0yzu',
  [ECS.PERSONA]: 'sha384-VfXTfuks02OkoR5USaTfEdc4NU25m4+vNrLATnjC0r0Pn1S3tFTdOvGCfSYdjE2I',
  [ECS.USER_AGENT]: 'sha384-rIWkh3zBD1Ak7CNGpAwZ/ONSmf+ywOYSF3H60ULc9/a1ZYKv6EqiQMJ2dm8dOfjm',
  [ECS.BADGE]: 'sha384-ZxJ2aRpoF/5DJSILWwOES6bmpMg3RZYOfO2CCF8hC/YDNvU+PhCqAnAXq/66nXCq',
}

// RFC 8785 JSON Canonicalization Scheme
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + (value as unknown[]).map(canonicalize).join(',') + ']'
  const obj = value as Record<string, unknown>
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
      .join(',') +
    '}'
  )
}

export async function computeSchemaDigest(schemaObj: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $id: _, ...schemaWithoutId } = schemaObj
  const canonical = canonicalize(schemaWithoutId)
  const encoded = new TextEncoder().encode(canonical)
  const hashBuffer = await crypto.subtle.digest('SHA-384', encoded)
  const bytes = new Uint8Array(hashBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `sha384-${btoa(binary)}`
}

/**
 * Identifies the ECS type for a given JSON schema object by computing its
 * SHA-384 digest (without the $id field) and comparing against known ECS digests.
 *
 * @returns The matching ECS type or null if no match is found.
 */
export async function identifySchema(schemaObj: Record<string, unknown>): Promise<ECS | null> {
  const actualDigest = await computeSchemaDigest(schemaObj)
  for (const [schemaName, refDigest] of Object.entries(ECS_SCHEMA_DIGESTS) as [ECS, string][]) {
    if (refDigest === actualDigest) return schemaName
  }
  return null
}

// Devnet and testnet ecosystems publish schemas that drift from the canonical ECS ones, so a
// digest miss falls back to the schema title before giving up.
const ECS_TITLE_BY_TYPE: Record<string, ECS> = {
  ServiceCredential: ECS.SERVICE,
  OrganizationCredential: ECS.ORG,
  PersonaCredential: ECS.PERSONA,
  UserAgentCredential: ECS.USER_AGENT,
  BadgeCredential: ECS.BADGE,
}

/**
 * Identifies the ECS type of a raw JSON schema string, as stored in a VPR `CredentialSchema`
 * entry, by digest and then by title.
 *
 * @returns The matching ECS type, or null when the string is not parseable or matches nothing.
 */
export async function classifyEcsSchema(jsonSchema: string): Promise<ECS | null> {
  try {
    const parsed = JSON.parse(jsonSchema) as Record<string, unknown>
    const byDigest = await identifySchema(parsed)
    if (byDigest) return byDigest
    const title = typeof parsed.title === 'string' ? parsed.title : ''
    return ECS_TITLE_BY_TYPE[title] ?? null
  } catch {
    return null
  }
}

type W3CCred = {
  credentialSubject?: { jsonSchema?: { $ref?: string } }
}

async function resolveBySubjectRef(subjectRef: string): Promise<ECS | 'other'> {
  const schemaFetchUrl = mapToEcosystem(subjectRef)
  const schemaObj = await fetch(schemaFetchUrl).then(r => (r.ok ? r.json() : null))
  if (!schemaObj) return 'other'
  return (await identifySchema(schemaObj as Record<string, unknown>)) ?? 'other'
}

async function resolveFromW3CCred(cred: W3CCred): Promise<ECS | 'other'> {
  const ref = cred.credentialSubject?.jsonSchema?.$ref
  if (!ref) return 'other'
  return resolveBySubjectRef(ref)
}

export async function resolveVTCType(item: {
  credential?: { credentialSchema?: { id?: string } }
}): Promise<ECS | 'other'> {
  try {
    const schemaUrl = item.credential?.credentialSchema?.id
    if (!schemaUrl) return 'other'

    const w3cCred = await fetch(schemaUrl).then(r => (r.ok ? r.json() : null))
    if (!w3cCred) return 'other'

    return resolveFromW3CCred(w3cCred as W3CCred)
  } catch {
    return 'other'
  }
}

export async function resolveJSCType(item: { credential?: W3CCred }): Promise<ECS | 'other'> {
  try {
    if (!item.credential) return 'other'
    return resolveFromW3CCred(item.credential)
  } catch {
    return 'other'
  }
}
