import { generateDigestSRI } from '@verana-labs/vs-agent-sdk'

const FETCH_TIMEOUT_MS = 30_000

export type TypeMetadataIntegrity = (url: string) => Promise<string>

// The integrity covers the served bytes, so the document must not be parsed on the way through.
export async function fetchTypeMetadata(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Failed to fetch the Type Metadata at ${url}: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

export function createTypeMetadataIntegrity(): TypeMetadataIntegrity {
  const digests = new Map<string, Promise<string>>()

  return url => {
    const cached = digests.get(url)
    if (cached) return cached

    const pending = fetchTypeMetadata(url).then(document => generateDigestSRI(document))
    digests.set(url, pending)
    pending.catch(() => digests.delete(url))
    return pending
  }
}
