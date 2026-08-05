import { DidDocument } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  createDID,
  MultibaseEncoding,
  multibaseEncode,
  prepareDataForSigning,
  resolveDIDFromLog,
  Signer,
  SigningInput,
  SigningOutput,
  updateDID,
  Verifier,
} from 'didwebvh-ts'
import { describe, expect, it } from 'vitest'

import { getLegacyDidDocument } from '../src/did/legacyDidWeb'
import { restoreShadowedWebVhDidDocument } from '../src/did/restoreShadowedWebVhDidDocument'

class InMemorySigner implements Signer {
  public constructor(
    private readonly secretKey: Uint8Array,
    private readonly publicKeyMultibase: string,
  ) {}

  public getVerificationMethodId(): string {
    return `did:key:${this.publicKeyMultibase}`
  }

  public async sign(input: SigningInput): Promise<SigningOutput> {
    const data = await prepareDataForSigning(input.document, input.proof)
    const signature = ed25519.sign(data, this.secretKey)
    return { proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC) }
  }
}

class InMemoryVerifier implements Verifier {
  public async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      return ed25519.verify(signature, message, publicKey)
    } catch {
      return false
    }
  }
}

function generateEd25519Identity() {
  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const publicKeyMultibase = multibaseEncode(
    new Uint8Array([0xed, 0x01, ...publicKey]),
    MultibaseEncoding.BASE58_BTC,
  )
  return { secretKey, publicKey, publicKeyMultibase }
}

async function makeAgentLikeDid(domain = 'example.com') {
  const { secretKey, publicKeyMultibase } = generateEd25519Identity()
  const signer = new InMemorySigner(secretKey, publicKeyMultibase)
  const verifier = new InMemoryVerifier()

  const baseDid = `did:webvh:{SCID}:${domain}`
  const created = await createDID({
    domain,
    signer,
    verifier,
    updateKeys: [publicKeyMultibase],
    verificationMethods: [
      {
        id: `${baseDid}#${publicKeyMultibase.slice(-8)}`,
        controller: baseDid,
        type: 'Multikey',
        publicKeyMultibase,
      },
    ],
  })

  const updated = await updateDID({
    log: created.log,
    signer,
    verifier,
    domain,
    updateKeys: [publicKeyMultibase],
    verificationMethods: created.doc.verificationMethod,
    services: [
      {
        id: `${created.did}#test-service`,
        type: 'TestService',
        serviceEndpoint: `https://${domain}/test`,
      },
    ],
    alsoKnownAs: [`did:web:${domain}`],
    controller: created.did,
  })

  const { doc } = await resolveDIDFromLog(updated.log, { verifier })
  return { did: created.did, log: updated.log, verifier, didDocument: DidDocument.fromJSON(doc) }
}

function corruptLikeParallelDidWebImport(didDocument: DidDocument): DidDocument {
  const shadowing = getLegacyDidDocument(didDocument, 'https://example.com')
  if (!shadowing) throw new Error('expected a legacy did:web document')
  return shadowing
}

describe('restoreShadowedWebVhDidDocument', () => {
  it('returns null when the document id matches the record did', async () => {
    const { did, log, verifier, didDocument } = await makeAgentLikeDid()
    const restored = await restoreShadowedWebVhDidDocument({ did, didDocument, log, verifier })
    expect(restored).toBeNull()
  })

  it('rebuilds the document from the log after an overwrite-import of the parallel did:web', async () => {
    const { did, log, verifier, didDocument } = await makeAgentLikeDid()
    const shadowing = corruptLikeParallelDidWebImport(didDocument)
    expect(shadowing.id).toBe('did:web:example.com')

    const restored = await restoreShadowedWebVhDidDocument({ did, didDocument: shadowing, log, verifier })
    if (!restored) throw new Error('expected the document to be restored')

    expect(restored.id).toBe(did)
    expect(restored.alsoKnownAs).toEqual(['did:web:example.com'])
    expect((restored.service ?? []).some(service => service.type === 'TestService')).toBe(true)
    expect((restored.service ?? []).some(service => service.type === 'AnonCredsRegistry')).toBe(false)

    const again = await restoreShadowedWebVhDidDocument({ did, didDocument: restored, log, verifier })
    expect(again).toBeNull()
  })

  it('throws when the document is shadowed and no log is stored', async () => {
    const { did, verifier, didDocument } = await makeAgentLikeDid()
    const shadowing = corruptLikeParallelDidWebImport(didDocument)
    await expect(
      restoreShadowedWebVhDidDocument({ did, didDocument: shadowing, log: undefined, verifier }),
    ).rejects.toThrow(/no webvh log/)
  })

  it('refuses to restore from a log that resolves to a different DID', async () => {
    const { did, verifier, didDocument } = await makeAgentLikeDid()
    const other = await makeAgentLikeDid('other.example.com')
    const shadowing = corruptLikeParallelDidWebImport(didDocument)
    await expect(
      restoreShadowedWebVhDidDocument({ did, didDocument: shadowing, log: other.log, verifier }),
    ).rejects.toThrow(/different DID/)
  })
})
