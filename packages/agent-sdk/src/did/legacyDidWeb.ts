import { DidDocument, parseDid, JsonTransformer } from '@credo-ts/core'

import { removeArtifactServices } from './artifactServices'

/**
 * Returns the legacy did:web form of a DID: the DID itself when it is already a did:web, and the
 * SCID-less did:web of a did:webvh. Returns undefined for any other method.
 */
export function getLegacyDidWeb(did: string): string | undefined {
  const parsedDid = parseDid(did)

  if (parsedDid.method === 'web') return did
  if (parsedDid.method === 'webvh' && parsedDid.id.includes(':')) {
    return `did:web:${parsedDid.id.split(':').slice(1).join(':')}`
  }
}

/**
 * Returns a Legacy did:web document, based on an input document. If it is already a did:web,
 * it returns the same document.
 * If it isn't supported (i.e. it is not a did:webvh DID Document), it returns undefined
 */
export function getLegacyDidDocument(didDocument: DidDocument) {
  const parsedDid = parseDid(didDocument.id)

  if (parsedDid.method === 'web') return didDocument

  // In case of did:webvh, we'll need to add some steps to publish a did:web, as per
  // https://identity.foundation/didwebvh/v1.0/#publishing-a-parallel-didweb-did
  if (parsedDid.method === 'webvh' && parsedDid.id.includes(':')) {
    const scid = parsedDid.id.split(':')[0]

    // Start with resolved version of the DIDDoc from did:webvh
    const legacyDidDocument = new DidDocument(didDocument)

    // The parallel document is for DIDComm only: it advertises no artifact service
    removeArtifactServices(legacyDidDocument)

    // Execute text replacement: did:webvh:<scid> by did:web
    const stringified = JSON.stringify(legacyDidDocument.toJSON())
    const replaced = stringified.replace(new RegExp(`did:webvh:${scid}`, 'g'), 'did:web')

    return new DidDocument({
      ...JsonTransformer.fromJSON(JSON.parse(replaced), DidDocument),
      // Update alsoKnownAs
      alsoKnownAs: [parsedDid.did],
    })
  }
}
