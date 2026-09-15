import { DidDocument } from '@credo-ts/core'
import { DIDLog, resolveDIDFromLog, Verifier } from 'didwebvh-ts'

export interface RestoreShadowedWebVhDidDocumentOptions {
  did: string
  didDocument: DidDocument | undefined
  log: DIDLog | undefined
  verifier: Verifier
}

/**
 * A `dids.import` of the agent's parallel did:web finds the webvh record itself through its
 * `alternativeDids` tag and, with `overwrite`, replaces that record's document in place while
 * `record.did` keeps naming the did:webvh. Resolution of the agent's own DID then answers with
 * a document whose id differs from the DID asked for, and the agent cannot boot. The webvh log
 * in the record's metadata is the one piece such an import never touches, so the document is
 * rebuilt from the resolved log head. Returns null when the record is consistent.
 */
export async function restoreShadowedWebVhDidDocument({
  did,
  didDocument,
  log,
  verifier,
}: RestoreShadowedWebVhDidDocumentOptions): Promise<DidDocument | null> {
  if (!didDocument || didDocument.id === did) return null

  if (!log?.length) {
    throw new Error(
      `did document of ${did} is shadowed by ${didDocument.id} and no webvh log is stored to restore it`,
    )
  }

  const { doc } = await resolveDIDFromLog(log, { verifier })
  if (doc.id !== did) {
    throw new Error(`webvh log of ${did} resolves to a different DID (${doc.id}); refusing to restore`)
  }

  return DidDocument.fromJSON(doc)
}
