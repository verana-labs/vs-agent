import { ed25519 } from '@noble/curves/ed25519.js'
import {
  createDID,
  DIDLog,
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

import { rebuildWebVhLog } from '../src/did/migrateWebVhLog'

class InMemorySigner implements Signer {
  public constructor(
    private readonly secretKey: Uint8Array,
    private readonly publicKeyMultibase: string,
  ) {}

  public getVerificationMethodId(): string {
    return `did:key:${this.publicKeyMultibase}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // Multikey ed25519 prefix: 0xed01
  const publicKeyMultibase = multibaseEncode(
    new Uint8Array([0xed, 0x01, ...publicKey]),
    MultibaseEncoding.BASE58_BTC,
  )
  return { secretKey, publicKey, publicKeyMultibase }
}

async function makeFreshLog() {
  const { secretKey, publicKeyMultibase } = generateEd25519Identity()
  const signer = new InMemorySigner(secretKey, publicKeyMultibase)
  const verifier = new InMemoryVerifier()

  const domain = 'example.com'
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

  // Append a second entry that adds a custom service, mirroring what VsAgent does.
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
        serviceEndpoint: 'https://example.com/test',
      },
    ],
    controller: created.did,
  })

  return { log: updated.log, signer, verifier }
}

/**
 * Mimic the legacy <2.7.4 hash-chain bug: tamper with the entryHash portion of
 * versionId for entries beyond the first so resolution fails with "Hash chain broken".
 * The state and parameters are left intact so the rebuild can faithfully restore them.
 */
function corruptHashChain(log: DIDLog): DIDLog {
  return log.map((entry, i) => {
    if (i === 0) return entry
    const [version] = entry.versionId.split('-')
    return { ...entry, versionId: `${version}-QmCorrupted0000000000000000000000000000000000000` }
  })
}

describe('rebuildWebVhLog', () => {
  it('returns null for an already-valid log (no-op)', async () => {
    const { log, signer, verifier } = await makeFreshLog()
    const result = await rebuildWebVhLog(log, { signer, verifier, domain: 'example.com' })
    expect(result).toBeNull()
  })

  it('rebuilds a hash-chain-broken log preserving SCID and entry states', async () => {
    const { log: goodLog, signer, verifier } = await makeFreshLog()
    const brokenLog = corruptHashChain(goodLog)

    // Sanity: broken log must indeed fail resolution with the expected error.
    await expect(resolveDIDFromLog(brokenLog, { verifier })).rejects.toThrow(/hash chain broken/i)

    const newLog = await rebuildWebVhLog(brokenLog, { signer, verifier, domain: 'example.com' })
    expect(newLog).not.toBeNull()
    expect(newLog!.length).toBe(goodLog.length)

    // Entry #1 must be byte-identical (and therefore SCID is preserved).
    expect(newLog![0]).toEqual(goodLog[0])

    // Subsequent entries must have the same state and parameters (only proof/versionId may differ).
    for (let i = 1; i < newLog!.length; i++) {
      expect(newLog![i].state).toEqual(goodLog[i].state)
      expect(newLog![i].parameters).toEqual(goodLog[i].parameters)
      expect(newLog![i].versionTime).toEqual(goodLog[i].versionTime)
    }

    // Rebuilt log must resolve cleanly with the same SCID.
    const resolved = await resolveDIDFromLog(newLog!, { verifier })
    expect(resolved.meta.scid).toBe(goodLog[0].parameters.scid)
  })
})
