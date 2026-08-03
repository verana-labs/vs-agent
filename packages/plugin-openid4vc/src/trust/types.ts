export type TrustVerdictName =
  | 'TRUSTED_AUTHORIZED'
  | 'TRUSTED_NOT_AUTHORIZED'
  | 'UNTRUSTED'
  | 'RESOLVER_UNAVAILABLE'

export type VeranaTrustStatus = 'TRUSTED' | 'PARTIAL' | 'UNTRUSTED'

export type TrustResolution =
  | { status: 'ok'; trustStatus: VeranaTrustStatus }
  | { status: 'not_found' }
  | { status: 'unreachable' }

export type TrustRole = 'issuer' | 'verifier'

export type KeyBindingResult = 'bound' | 'unbound' | 'unresolvable'

export interface TrustEvidence {
  did: string | null
  trustStatus: VeranaTrustStatus | null
  vtjscId: string | null
  authorized: boolean | null
  queries: string[]
  note?: string
}

export interface TrustVerdict {
  verdict: TrustVerdictName
  evidence: TrustEvidence
}

export interface TrustClientOptions {
  resolverUrl: string
  timeoutMs: number
}
