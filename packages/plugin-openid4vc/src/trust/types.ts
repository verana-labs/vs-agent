export const TRUST_VERDICT_NAMES = [
  'TRUSTED_AUTHORIZED',
  'TRUSTED_NOT_AUTHORIZED',
  'UNTRUSTED',
  'RESOLVER_UNAVAILABLE',
] as const

export type TrustVerdictName = (typeof TRUST_VERDICT_NAMES)[number]

export const VERANA_TRUST_STATUSES = ['TRUSTED', 'PARTIAL', 'UNTRUSTED'] as const

export type VeranaTrustStatus = (typeof VERANA_TRUST_STATUSES)[number]

export type KeyBindingResult = 'bound' | 'unbound' | 'unresolvable'

export interface TrustEvidence {
  did: string | null
  trustStatus: VeranaTrustStatus | null
  jsonSchemaCredentialId: string | null
  authorized: boolean | null
  queries: string[]
  note?: string
}

export interface TrustVerdict {
  verdict: TrustVerdictName
  evidence: TrustEvidence
}
