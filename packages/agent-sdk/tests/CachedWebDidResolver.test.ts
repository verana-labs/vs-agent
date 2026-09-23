import type { AgentContext } from '@credo-ts/core'

import { describe, expect, it, vi } from 'vitest'

import { CachedWebDidResolver } from '../src/did/CachedWebDidResolver'

const DID = 'did:web:issuer.example'
const DID_URL = 'https://issuer.example/.well-known/did.json'

function resolverContext(fetchImplementation: typeof fetch): AgentContext {
  const didRepository = { findSingleByQuery: vi.fn(async () => null) }
  return {
    config: { agentDependencies: { fetch: fetchImplementation } },
    dependencyManager: { resolve: vi.fn(() => didRepository) },
  } as unknown as AgentContext
}

function resolve(fetchImplementation: typeof fetch, did = DID) {
  return new CachedWebDidResolver().resolve(resolverContext(fetchImplementation), did, {
    did,
    method: 'web',
    id: did.slice('did:web:'.length),
  } as never)
}

describe('CachedWebDidResolver', () => {
  it('builds a did:web document from one direct manual-redirect response', async () => {
    const fetchImplementation = vi.fn(
      async () =>
        ({
          status: 200,
          redirected: false,
          url: DID_URL,
          json: async () => ({ id: DID }),
        }) as unknown as Response,
    )

    const result = await resolve(fetchImplementation)

    expect(result.didDocument?.id).toBe(DID)
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledWith(DID_URL, { redirect: 'manual' })
  })

  it('rejects a did:web redirect without following it', async () => {
    const fetchImplementation = vi.fn(
      async () => ({ status: 302, redirected: false, url: DID_URL }) as unknown as Response,
    )

    const result = await resolve(fetchImplementation)

    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('notFound')
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledWith(DID_URL, { redirect: 'manual' })
  })

  it('rejects a followed redirect reported after the fact', async () => {
    const fetchImplementation = vi.fn(
      async () =>
        ({
          status: 200,
          redirected: true,
          url: 'https://elsewhere.example/.well-known/did.json',
          json: async () => ({ id: DID }),
        }) as unknown as Response,
    )

    const result = await resolve(fetchImplementation)

    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('notFound')
  })

  it('rejects a document whose id is not the requested did', async () => {
    const fetchImplementation = vi.fn(
      async () =>
        ({
          status: 200,
          redirected: false,
          url: DID_URL,
          json: async () => ({ id: 'did:web:other.example' }),
        }) as unknown as Response,
    )

    const result = await resolve(fetchImplementation)

    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('notFound')
  })

  it('maps the deprecated publicKey property onto verificationMethod', async () => {
    const fetchImplementation = vi.fn(
      async () =>
        ({
          status: 200,
          redirected: false,
          url: DID_URL,
          json: async () => ({
            id: DID,
            publicKey: [
              {
                id: `${DID}#key-1`,
                type: 'Ed25519VerificationKey2018',
                controller: DID,
                publicKeyBase58: '6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG',
              },
            ],
          }),
        }) as unknown as Response,
    )

    const result = await resolve(fetchImplementation)

    expect(result.didDocument?.verificationMethod?.[0]?.id).toBe(`${DID}#key-1`)
  })
})
