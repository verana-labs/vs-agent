export enum ECS {
  SERVICE = 'ecs-service',
  ORG = 'ecs-org',
  PERSONA = 'ecs-persona',
  USER_AGENT = 'ecs-user-agent',
}

const urlMap = new Map<string, string>([
  ['vpr:verana:vna-mainnet-1', 'https://idx.testnet.verana.network/verana'],
  ['vpr:verana:vna-testnet-1', 'https://idx.testnet.verana.network/verana'],
  ['vpr:verana:vna-devnet-1', 'https://idx.devnet.verana.network/verana'],
])

export function mapToEcosystem(input: string): string {
  for (const [key, value] of urlMap.entries()) {
    if (input.includes(key)) {
      input = input.replace(key, value)
    }
  }
  return input
}

export const ECS_SCHEMA_DIGESTS: Record<ECS, string> = {
  [ECS.SERVICE]: 'sha384-PVseqJJjEGMVRcht77rE2yLqRnCiLBRLOklSuAshSEXK3eyITmUpDBhpQryJ/XIx',
  [ECS.ORG]: 'sha384-XF10SsOaav+i+hBaXP29coZWZeaCZocFvfP9ZeHh9B7++q7YGA2QLTbFZqtYs/zA',
  [ECS.PERSONA]: 'sha384-4vkQl6Ro6fudr+g5LL2NQJWVxaSTaYkyf0yVPVUmzA2leNNn0sJIsM07NlOAG/2I',
  [ECS.USER_AGENT]: 'sha384-yLRK2mCokVjRlGX0nVzdEYQ1o6YWpQqgdg6+HlSxCePP+D7wvs0+70TJACLZfbF/',
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

async function computeSchemaDigest(schemaObj: Record<string, unknown>): Promise<string> {
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

/**
 * Resolves the ECS credential type for a linked credential item by:
 * 1. Reading credentialSchema.id from the credential
 * 2. Fetching that URL → W3C credential with credentialSubject.id (a VPR URL)
 * 3. Applying mapToEcosystem to get a resolvable HTTP URL
 * 4. Fetching the JSON schema and identifying it via SHA-384 digest
 *
 * @returns The ECS type string (e.g. 'ecs-org') or 'other' on any failure.
 */
export async function resolveCredentialType(item: {
  credential?: { credentialSchema?: { id?: string } }
}): Promise<ECS | 'other'> {
  try {
    const schemaUrl = item.credential?.credentialSchema?.id
    if (!schemaUrl) return 'other'

    const w3cCred = await fetch(schemaUrl).then(r => (r.ok ? r.json() : null))
    if (!w3cCred) return 'other'

    const subjectId = (w3cCred as { credentialSubject?: { id?: string } }).credentialSubject?.id
    if (!subjectId) return 'other'

    const schemaFetchUrl = mapToEcosystem(subjectId)
    const schemaObj = await fetch(schemaFetchUrl).then(r => (r.ok ? r.json() : null))
    if (!schemaObj) return 'other'

    return (await identifySchema(schemaObj as Record<string, unknown>)) ?? 'other'
  } catch {
    return 'other'
  }
}
