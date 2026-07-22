import type { TrustResolution, TrustVerdictName } from './types'

export function computeVerdict(resolution: TrustResolution, authorized: boolean | null): TrustVerdictName {
  if (resolution.status === 'unreachable') return 'RESOLVER_UNAVAILABLE'
  if (resolution.status === 'not_found' || resolution.trustStatus !== 'TRUSTED') return 'UNTRUSTED'
  if (authorized === null) return 'RESOLVER_UNAVAILABLE'

  return authorized ? 'TRUSTED_AUTHORIZED' : 'TRUSTED_NOT_AUTHORIZED'
}
