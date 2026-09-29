import { digestOfBoundedUri } from '@verana-labs/vs-agent-sdk'

export const FAILURE_CACHE_MS = 5_000

export interface TypeMetadataIntegrity {
  digest(url: string): Promise<string>
  invalidate(url: string): void
}

export function createTypeMetadataIntegrity(): TypeMetadataIntegrity {
  const digests = new Map<string, Promise<string>>()
  const failures = new Map<string, { at: number; failure: Promise<string> }>()

  return {
    digest(url) {
      const cached = digests.get(url)
      if (cached) return cached

      const failed = failures.get(url)
      if (failed && Date.now() - failed.at < FAILURE_CACHE_MS) return failed.failure

      const pending = digestOfBoundedUri(url)
      digests.set(url, pending)
      pending.catch(() => {
        digests.delete(url)
        failures.set(url, { at: Date.now(), failure: pending })
      })
      return pending
    },
    invalidate(url) {
      digests.delete(url)
      failures.delete(url)
    },
  }
}
