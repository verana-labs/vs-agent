import type { KeyBindingResult } from './types'
import type { BaseAgent, DidDocument, DidPurpose, VerificationMethod } from '@credo-ts/core'

import { getPublicJwkFromVerificationMethod, Kms, tryParseDid } from '@credo-ts/core'
import { BlockList, isIP } from 'node:net'

type BindingPurpose = Extract<DidPurpose, 'assertionMethod' | 'authentication'>
export type DidResolverAgent = Pick<BaseAgent, 'dids'>

export const DEFAULT_DID_RESOLUTION_TIMEOUT_MS = 5_000
export const MAX_DID_RESOLUTION_TIMEOUT_MS = 30_000
const NON_PUBLIC_IPS = createNonPublicIpBlockList()

export interface DidResolutionPolicy {
  allowedWebHosts: string[]
  timeoutMs: number
  allowNonPublicHosts?: boolean
}

export function ownDidResolutionPolicy(
  did: string,
  timeoutMs = DEFAULT_DID_RESOLUTION_TIMEOUT_MS,
): DidResolutionPolicy {
  const host = didWebHost(did)
  return { allowedWebHosts: host ? [host] : [], timeoutMs, allowNonPublicHosts: true }
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

// MOSIP Inji's OpenID4VP library declares a RequestSigningAlgorithm enum whose only constant is EdDSA and
// rejects anything else before reading the request.
export async function findEd25519VerificationMethodId(
  agent: DidResolverAgent,
  did: string | null,
  purposes: BindingPurpose[],
  resolutionPolicy: DidResolutionPolicy,
): Promise<string | null> {
  if (!did) return null

  const didDocument = await resolveDidDocument(agent, did, resolutionPolicy)
  if (!didDocument) return null

  for (const verificationMethod of verificationMethodsForPurposes(didDocument, purposes)) {
    try {
      const jwk = getPublicJwkFromVerificationMethod(verificationMethod).toJson() as {
        kty?: string
        crv?: string
      }
      if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return verificationMethod.id
    } catch {}
  }

  return null
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
  if (!policy.allowNonPublicHosts && isNonPublicHost(new URL(`https://${requestedHost}`).hostname)) {
    return false
  }

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

function isNonPublicHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === 'home.arpa' ||
    normalized.endsWith('.home.arpa')
  ) {
    return true
  }

  const ipVersion = isIP(normalized)
  return ipVersion === 4
    ? NON_PUBLIC_IPS.check(normalized, 'ipv4')
    : ipVersion === 6
      ? NON_PUBLIC_IPS.check(normalized, 'ipv6')
      : false
}

function createNonPublicIpBlockList(): BlockList {
  const blockList = new BlockList()
  blockList.addSubnet('0.0.0.0', 8, 'ipv4')
  blockList.addSubnet('10.0.0.0', 8, 'ipv4')
  blockList.addSubnet('100.64.0.0', 10, 'ipv4')
  blockList.addSubnet('127.0.0.0', 8, 'ipv4')
  blockList.addSubnet('169.254.0.0', 16, 'ipv4')
  blockList.addSubnet('172.16.0.0', 12, 'ipv4')
  blockList.addSubnet('192.0.0.0', 24, 'ipv4')
  blockList.addSubnet('192.168.0.0', 16, 'ipv4')
  blockList.addSubnet('198.18.0.0', 15, 'ipv4')
  blockList.addSubnet('224.0.0.0', 3, 'ipv4')
  blockList.addSubnet('::', 128, 'ipv6')
  blockList.addSubnet('::1', 128, 'ipv6')
  blockList.addSubnet('::ffff:0:0', 96, 'ipv6')
  blockList.addSubnet('fc00::', 7, 'ipv6')
  blockList.addSubnet('fe80::', 10, 'ipv6')
  blockList.addSubnet('ff00::', 8, 'ipv6')
  return blockList
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
