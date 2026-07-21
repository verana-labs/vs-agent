import type { KeyBindingResult, TrustVerdict } from './types'
import type { BaseAgent, DidPurpose, VerificationMethod } from '@credo-ts/core'

import { getPublicJwkFromVerificationMethod, Kms, tryParseDid } from '@credo-ts/core'
import { BlockList, isIP } from 'node:net'

type BindingPurpose = Extract<DidPurpose, 'assertionMethod' | 'authentication'>
type DidResolverAgent = Pick<BaseAgent, 'dids'>

export const DEFAULT_DID_RESOLUTION_TIMEOUT_MS = 5_000
export const MAX_DID_RESOLUTION_TIMEOUT_MS = 30_000
const NON_PUBLIC_IPS = createNonPublicIpBlockList()

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
  if (!did) return 'unbound'

  let certificateKey: Kms.PublicJwk
  try {
    certificateKey = Kms.PublicJwk.fromUnknown(certificatePublicJwk)
  } catch {
    return 'unbound'
  }

  if (!isResolutionAllowed(did, resolutionPolicy)) return 'unresolvable'

  let didDocument
  try {
    const resolution = await withTimeout(agent.dids.resolve(did), resolutionPolicy.timeoutMs)
    if (resolution.didResolutionMetadata?.error || !resolution.didDocument) return 'unresolvable'
    if (resolution.didDocument.id !== did) return 'unresolvable'
    didDocument = resolution.didDocument
  } catch {
    return 'unresolvable'
  }

  for (const purpose of purposes) {
    for (const entry of didDocument[purpose] ?? []) {
      let verificationMethod: VerificationMethod
      try {
        verificationMethod =
          typeof entry === 'string' ? didDocument.dereferenceVerificationMethod(entry) : entry
      } catch {
        continue
      }

      try {
        const methodKey = getPublicJwkFromVerificationMethod(verificationMethod)
        if (certificateKey.equals(methodKey)) return 'bound'
      } catch {
        continue
      }
    }
  }

  return 'unbound'
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
  if (!requestedHost || isNonPublicHost(new URL(`https://${requestedHost}`).hostname)) return false

  // Credo owns fetch and redirect handling, so this exact operator allowlist is the network trust boundary.
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

export function blockingBindingVerdict(
  did: string | null,
  vtjscId: string | null,
  binding: Exclude<KeyBindingResult, 'bound'>,
): TrustVerdict {
  return {
    verdict: binding === 'unresolvable' ? 'RESOLVER_UNAVAILABLE' : 'UNTRUSTED',
    evidence: {
      did,
      trustStatus: null,
      vtjscId,
      authorized: null,
      queries: [],
      note:
        binding === 'unresolvable'
          ? 'the asserted DID could not be resolved for key binding'
          : 'the certificate public key is not authorized by the asserted DID document',
    },
  }
}
