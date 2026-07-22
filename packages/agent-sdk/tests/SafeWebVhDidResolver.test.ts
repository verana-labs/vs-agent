import type { AgentContext } from '@credo-ts/core'
import type { Signer, SigningInput, SigningOutput, Verifier } from 'didwebvh-ts'

import { ed25519 } from '@noble/curves/ed25519.js'
import { createDID, MultibaseEncoding, multibaseEncode, prepareDataForSigning } from 'didwebvh-ts'
import { describe, expect, it, vi } from 'vitest'

import { SafeWebVhDidResolver } from '../src/did/SafeWebVhDidResolver'

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
    return { proofValue: multibaseEncode(ed25519.sign(data, this.secretKey), MultibaseEncoding.BASE58_BTC) }
  }
}

class InMemoryVerifier implements Verifier {
  public async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return ed25519.verify(signature, message, publicKey)
  }
}

async function signedLog() {
  const secretKey = new Uint8Array(32).fill(7)
  const publicKey = ed25519.getPublicKey(secretKey)
  const publicKeyMultibase = multibaseEncode(
    new Uint8Array([0xed, 0x01, ...publicKey]),
    MultibaseEncoding.BASE58_BTC,
  )
  const baseDid = 'did:webvh:{SCID}:issuer.example'
  const created = await createDID({
    domain: 'issuer.example',
    signer: new InMemorySigner(secretKey, publicKeyMultibase),
    verifier: new InMemoryVerifier(),
    updateKeys: [publicKeyMultibase],
    verificationMethods: [
      {
        id: `${baseDid}#key-1`,
        controller: baseDid,
        type: 'Multikey',
        publicKeyMultibase,
      },
    ],
  })

  return { log: created.log, did: created.did, publicKey }
}

function resolverContext(fetchImplementation: typeof fetch, publicKey: Uint8Array): AgentContext {
  return {
    config: {
      agentDependencies: { fetch: fetchImplementation },
      logger: { error: vi.fn() },
    },
    dependencyManager: {
      resolve: vi.fn(() => ({
        verify: vi.fn(async ({ signature, data }) => ({
          verified: ed25519.verify(signature, data, publicKey),
        })),
      })),
    },
  } as unknown as AgentContext
}

describe('SafeWebVhDidResolver', () => {
  it('builds a did:webvh document from one direct manually redirected log response', async () => {
    const { did, log, publicKey } = await signedLog()
    const url = 'https://issuer.example/.well-known/did.jsonl'
    const fetchImplementation = vi.fn(
      async () =>
        ({
          status: 200,
          redirected: false,
          url,
          text: async () => log.map(entry => JSON.stringify(entry)).join('\n'),
        }) as unknown as Response,
    )

    const result = await new SafeWebVhDidResolver().resolve(
      resolverContext(fetchImplementation, publicKey),
      did,
    )

    expect(result.didDocument?.id).toBe(did)
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledWith(url, { redirect: 'manual' })
  })

  it('rejects a did:webvh redirect without following it', async () => {
    const { did, publicKey } = await signedLog()
    const url = 'https://issuer.example/.well-known/did.jsonl'
    const fetchImplementation = vi.fn(
      async () => ({ status: 302, redirected: false, url }) as unknown as Response,
    )

    const result = await new SafeWebVhDidResolver().resolve(
      resolverContext(fetchImplementation, publicKey),
      did,
    )

    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('notFound')
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledWith(url, { redirect: 'manual' })
  })
})
