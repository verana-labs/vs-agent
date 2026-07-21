import type { KeyBindingResult, TrustVerdict } from './types'
import type { BaseAgent, DidPurpose, VerificationMethod } from '@credo-ts/core'

import { getPublicJwkFromVerificationMethod, Kms } from '@credo-ts/core'

type BindingPurpose = Extract<DidPurpose, 'assertionMethod' | 'authentication'>
type DidResolverAgent = Pick<BaseAgent, 'dids'>

export async function verifyKeyBoundToDid(
  agent: DidResolverAgent,
  did: string | null,
  certificatePublicJwk: unknown,
  purposes: BindingPurpose[] = ['assertionMethod'],
): Promise<KeyBindingResult> {
  if (!did) return 'unbound'

  let certificateKey: Kms.PublicJwk
  try {
    certificateKey = Kms.PublicJwk.fromUnknown(certificatePublicJwk)
  } catch {
    return 'unbound'
  }

  let didDocument
  try {
    const resolution = await agent.dids.resolve(did)
    if (resolution.didResolutionMetadata?.error || !resolution.didDocument) return 'unresolvable'
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
