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

import { rebuildWebVhVersionTimes } from '../src/did/migrateWebVhVersionTime'

import sameSecondLegacyLog from './fixtures/webvh-same-second-2.7.4.json'

const secretKey = new Uint8Array(32).fill(7)
const publicKeyMultibase = multibaseEncode(
  new Uint8Array([0xed, 0x01, ...ed25519.getPublicKey(secretKey)]),
  MultibaseEncoding.BASE58_BTC,
)

class InMemorySigner implements Signer {
  public getVerificationMethodId(): string {
    return `did:key:${publicKeyMultibase}`
  }

  public async sign(input: SigningInput): Promise<SigningOutput> {
    const data = await prepareDataForSigning(input.document, input.proof)
    return { proofValue: multibaseEncode(ed25519.sign(data, secretKey), MultibaseEncoding.BASE58_BTC) }
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

const signer = new InMemorySigner()
const verifier = new InMemoryVerifier()
const opts = { signer, verifier, domain: 'example.com' }

async function makeFreshLog(): Promise<DIDLog> {
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

  return updated.log
}

describe('rebuildWebVhVersionTimes', () => {
  it('returns null for an already-valid log (no-op)', async () => {
    const log = await makeFreshLog()
    expect(await rebuildWebVhVersionTimes(log, opts)).toBeNull()
  })

  // Fixture written by didwebvh-ts 2.7.4: create + immediate update landed in the same second,
  // which >=2.8.0 rejects at resolution.
  it('re-stamps a same-second legacy log so it resolves again', async () => {
    const log = sameSecondLegacyLog as unknown as DIDLog
    expect(log[0].versionTime).toBe(log[1].versionTime)
    await expect(resolveDIDFromLog(log, { verifier })).rejects.toThrow(
      /must be greater than previous entry time/i,
    )

    const newLog = await rebuildWebVhVersionTimes(log, opts)
    expect(newLog).not.toBeNull()
    expect(newLog!.length).toBe(log.length)
    expect(newLog![0]).toEqual(log[0])
    for (let i = 1; i < newLog!.length; i++) {
      expect(Date.parse(newLog![i].versionTime)).toBeGreaterThan(Date.parse(newLog![i - 1].versionTime))
    }

    const resolved = await resolveDIDFromLog(newLog!, { verifier })
    expect(resolved.meta.scid).toBe(log[0].parameters.scid)
    expect(resolved.doc.service).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expect.stringContaining('#test-service') })]),
    )
    expect(resolved.doc.verificationMethod).toEqual(log[log.length - 1].state.verificationMethod)

    expect(await rebuildWebVhVersionTimes(newLog!, opts)).toBeNull()
  })

  it('also repairs hash-chain-broken logs (a hash break can mask a same-second pair)', async () => {
    const log = await makeFreshLog()
    const broken = log.map((entry, i) =>
      i === 0
        ? entry
        : {
            ...entry,
            versionId: `${entry.versionId.split('-')[0]}-QmCorrupted0000000000000000000000000000000000000`,
          },
    ) as DIDLog
    await expect(resolveDIDFromLog(broken, { verifier })).rejects.toThrow(/hash chain broken/i)

    const newLog = await rebuildWebVhVersionTimes(broken, opts)
    expect(newLog).not.toBeNull()
    expect(newLog![0]).toEqual(log[0])
    for (let i = 1; i < newLog!.length; i++) {
      expect(newLog![i].versionTime).toBe(log[i].versionTime)
    }
    const resolved = await resolveDIDFromLog(newLog!, { verifier })
    expect(resolved.meta.scid).toBe(log[0].parameters.scid)
  })
})
