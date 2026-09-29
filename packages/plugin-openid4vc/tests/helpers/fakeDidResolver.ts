import type { AgentContext, DidPurpose, DidResolutionResult, DidResolver } from '@credo-ts/core'

import { DidDocument, JsonTransformer } from '@credo-ts/core'

type TestDidPurpose = Extract<DidPurpose, 'assertionMethod' | 'authentication'>

export function didDocumentWithKey(
  did: string,
  publicJwk: Record<string, unknown>,
  purposes: TestDidPurpose[],
): DidDocument {
  const verificationMethodId = `${did}#key-1`
  return JsonTransformer.fromJSON(
    {
      id: did,
      verificationMethod: [
        {
          id: verificationMethodId,
          type: 'JsonWebKey2020',
          controller: did,
          publicKeyJwk: publicJwk,
        },
      ],
      ...Object.fromEntries(purposes.map(purpose => [purpose, [verificationMethodId]])),
    },
    DidDocument,
  )
}

/** A DID Document that publishes one service entry and no key, as an Ecosystem controller does. */
export function didDocumentWithService(
  did: string,
  service: { id: string; type: string; serviceEndpoint: string },
): DidDocument {
  return JsonTransformer.fromJSON({ id: did, service: [service] }, DidDocument)
}

export class FakeDidResolver implements DidResolver {
  public readonly supportedMethods = ['web']
  public readonly allowsCaching = false
  public readonly allowsLocalDidRecord = false

  public constructor(public readonly documents: Map<string, DidDocument>) {}

  public async resolve(_agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const didDocument = this.documents.get(did) ?? null
    return {
      didDocument,
      didDocumentMetadata: {},
      didResolutionMetadata: didDocument ? {} : { error: 'notFound' },
    }
  }
}
