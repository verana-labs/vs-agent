import { type JsonCredential } from '@credo-ts/didcomm'

import { generateDigestSRI } from '../utils'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`
}

// Excludes the proof so re-signing at issuance (new proof bytes) does not change the digest.
export function credentialContentDigest(credential: JsonCredential): string {
  const content = { ...credential }
  delete content.proof
  return generateDigestSRI(canonicalJson(content))
}
