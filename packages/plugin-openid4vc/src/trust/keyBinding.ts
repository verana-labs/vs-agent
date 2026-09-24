import type { KeyBindingResult } from './types'
import type { BaseAgent, DidDocument, DidPurpose, VerificationMethod } from '@credo-ts/core'

import { getPublicJwkFromVerificationMethod, Kms, tryParseDid } from '@credo-ts/core'

type BindingPurpose = Extract<DidPurpose, 'assertionMethod' | 'authentication'>
export type DidResolverAgent = Pick<BaseAgent, 'dids'>

export const DEFAULT_DID_RESOLUTION_TIMEOUT_MS = 5_000
export const MAX_DID_RESOLUTION_TIMEOUT_MS = 30_000

export interface DidResolutionPolicy {
  allowedWebHosts: string[]
  timeoutMs: number
}

export function ownDidResolutionPolicy(
  did: string,
  timeoutMs = DEFAULT_DID_RESOLUTION_TIMEOUT_MS,
): DidResolutionPolicy {
  const host = didWebHost(did)
  return { allowedWebHosts: host ? [host] : [], timeoutMs }
}

export async function verifyKeyBoundToDid(
  agent: DidResolverAgent,
  did: string | null,
  certificatePublicJwk: unknown,
  purposes: BindingPurpose[],
  resolutionPolicy: DidResolutionPolicy,
): Promise<KeyBindingResult> {
  const lookup = await lookupBoundVerificationMethod(
    agent,
    did,
    certificatePublicJwk,
    purposes,
    resolutionPolicy,
  )
  return lookup.result
}

export async function findBoundVerificationMethodId(
  agent: DidResolverAgent,
  did: string | null,
  certificatePublicJwk: unknown,
  purposes: BindingPurpose[],
  resolutionPolicy: DidResolutionPolicy,
): Promise<string | null> {
  const lookup = await lookupBoundVerificationMethod(
    agent,
    did,
    certificatePublicJwk,
    purposes,
    resolutionPolicy,
  )
  return lookup.result === 'bound' ? lookup.verificationMethodId : null
}

type BoundKeyLookup =
  | { result: 'bound'; verificationMethodId: string }
  | { result: 'unbound' | 'unresolvable' }

async function lookupBoundVerificationMethod(
  agent: DidResolverAgent,
  did: string | null,
  certificatePublicJwk: unknown,
  purposes: BindingPurpose[],
  resolutionPolicy: DidResolutionPolicy,
): Promise<BoundKeyLookup> {
  if (!did) return { result: 'unbound' }

  let certificateKey: Kms.PublicJwk
  try {
    certificateKey = Kms.PublicJwk.fromUnknown(certificatePublicJwk)
  } catch {
    return { result: 'unbound' }
  }

  const didDocument = await resolveDidDocument(agent, did, resolutionPolicy)
  if (!didDocument) return { result: 'unresolvable' }

  for (const verificationMethod of verificationMethodsForPurposes(didDocument, purposes)) {
    try {
      if (certificateKey.equals(getPublicJwkFromVerificationMethod(verificationMethod))) {
        return { result: 'bound', verificationMethodId: verificationMethod.id }
      }
    } catch {}
  }

  return { result: 'unbound' }
}

async function resolveDidDocument(
  agent: DidResolverAgent,
  did: string,
  policy: DidResolutionPolicy,
): Promise<DidDocument | null> {
  if (!isResolutionAllowed(did, policy)) return null

  try {
    const resolution = await withTimeout(
      agent.dids.resolve(did, { useCache: false, persistInCache: false }),
      policy.timeoutMs,
    )
    if (resolution.didResolutionMetadata?.error || !resolution.didDocument) return null
    if (resolution.didDocument.id !== did) return null
    return resolution.didDocument
  } catch {
    return null
  }
}

function* verificationMethodsForPurposes(
  didDocument: DidDocument,
  purposes: BindingPurpose[],
): Generator<VerificationMethod> {
  for (const purpose of purposes) {
    for (const entry of didDocument[purpose] ?? []) {
      let verificationMethod: VerificationMethod
      try {
        verificationMethod =
          typeof entry === 'string' ? didDocument.dereferenceVerificationMethod(entry) : entry
      } catch {
        continue
      }

      yield verificationMethod
    }
  }
}

function isResolutionAllowed(did: string, policy: DidResolutionPolicy): boolean {
  if (
    !Number.isInteger(policy.timeoutMs) ||
    policy.timeoutMs <= 0 ||
    policy.timeoutMs > MAX_DID_RESOLUTION_TIMEOUT_MS ||
    !Array.isArray(policy.allowedWebHosts)
  ) {
    return false
  }

  const requestedHost = didWebHost(did)
  if (!requestedHost) return false

  return policy.allowedWebHosts.some(allowedHost => canonicalHost(allowedHost) === requestedHost)
}

function didWebHost(did: string): string | undefined {
  const parsed = tryParseDid(did)
  if (!parsed || parsed.did !== did) return undefined

  const components = parsed.id.split(':')
  const encodedHost =
    parsed.method === 'web'
      ? components[0]
      : parsed.method === 'webvh' && components.length >= 2 && components[0]
        ? components[1]
        : undefined
  if (!encodedHost) return undefined

  try {
    return canonicalHost(decodeURIComponent(encodedHost))
  } catch {
    return undefined
  }
}

function canonicalHost(value: string): string | undefined {
  try {
    const url = new URL(`https://${value}`)
    if (!url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return undefined
    }

    return url.host.toLowerCase()
  } catch {
    return undefined
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('DID resolution timed out')), timeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
