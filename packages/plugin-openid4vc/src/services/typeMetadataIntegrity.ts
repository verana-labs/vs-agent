import { generateDigestSRI } from '@verana-labs/vs-agent-sdk'

const FETCH_TIMEOUT_MS = 30_000

export interface TypeMetadataIntegrity {
  digest(url: string): Promise<string>
  invalidate(): void
}

// The digest covers the bytes on the wire: `response.text()` would decode per the response charset and
// strip a leading BOM, and the digest would then cover a re-encoding of the document.
export async function fetchTypeMetadata(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Failed to fetch the Type Metadata at ${url}: ${response.status} ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export function createTypeMetadataIntegrity(): TypeMetadataIntegrity {
  const digests = new Map<string, Promise<string>>()

  return {
    digest(url) {
      const cached = digests.get(url)
      if (cached) return cached

      const pending = fetchTypeMetadata(url).then(document => generateDigestSRI(document))
      digests.set(url, pending)
      pending.catch(() => digests.delete(url))
      return pending
    },
    invalidate() {
      digests.clear()
    },
  }
}
