import type { KeyBindingResult } from './types'
import type { BaseAgent, DidDocument, DidPurpose, VerificationMethod } from '@credo-ts/core'

import { getPublicJwkFromVerificationMethod, Kms } from '@credo-ts/core'
import { getDidWebHttpsBaseUrl } from '@verana-labs/vs-agent-sdk'

type BindingPurpose = Extract<DidPurpose, 'assertionMethod' | 'authentication'>
export type DidResolverAgent = Pick<BaseAgent, 'dids'>

const DID_RESOLUTION_TIMEOUT_MS = 5_000

export async function verifyKeyBoundToDid(
  agent: DidResolverAgent,
  did: string | null,
  certificatePublicJwk: unknown,
  purposes: BindingPurpose[],
): Promise<KeyBindingResult> {
  const lookup = await lookupBoundVerificationMethod(agent, did, certificatePublicJwk, purposes)
  return lookup.result
}

export async function findBoundVerificationMethodId(
  agent: DidResolverAgent,
  did: string | null,
  certificatePublicJwk: unknown,
  purposes: BindingPurpose[],
): Promise<string | null> {
  const lookup = await lookupBoundVerificationMethod(agent, did, certificatePublicJwk, purposes)
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
): Promise<BoundKeyLookup> {
  if (!did) return { result: 'unbound' }

  let certificateKey: Kms.PublicJwk
  try {
    certificateKey = Kms.PublicJwk.fromUnknown(certificatePublicJwk)
  } catch {
    return { result: 'unbound' }
  }

  const didDocument = await resolveDidDocument(agent, did)
  if (!didDocument) return { result: 'unresolvable' }

  const verificationMethodId = boundVerificationMethod(didDocument, certificateKey, purposes)
  return verificationMethodId ? { result: 'bound', verificationMethodId } : { result: 'unbound' }
}

/** The id of the verification method under one of the purposes that carries the key, if any. */
export function boundVerificationMethod(
  didDocument: DidDocument,
  key: Kms.PublicJwk,
  purposes: BindingPurpose[],
): string | undefined {
  for (const verificationMethod of verificationMethodsForPurposes(didDocument, purposes)) {
    try {
      if (key.equals(getPublicJwkFromVerificationMethod(verificationMethod))) return verificationMethod.id
    } catch {}
  }
  return undefined
}

/**
 * Resolves a did:web or did:webvh, fresh, within 5 seconds, and only when the document carries the
 * requested DID as its id ([VSA-VTI-FLOW-VERIFY-OID] step 3). Null when any of that fails.
 */
export async function resolveDidDocument(agent: DidResolverAgent, did: string): Promise<DidDocument | null> {
  if (!isDidWebTarget(did)) return null

  try {
    const resolution = await withTimeout(
      agent.dids.resolve(did, { useCache: false, persistInCache: false }),
      DID_RESOLUTION_TIMEOUT_MS,
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

function isDidWebTarget(did: string): boolean {
  try {
    return getDidWebHttpsBaseUrl(did) !== undefined
  } catch {
    return false
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
