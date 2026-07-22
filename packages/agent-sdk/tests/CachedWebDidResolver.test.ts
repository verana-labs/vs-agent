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
    const resolver = new CachedWebDidResolver({ publicApiBaseUrl: 'https://agent.example' })

    const result = await resolver.resolve(
      resolverContext(fetchImplementation),
      DID,
      { did: DID, method: 'web', id: 'issuer.example' } as never,
      {},
    )

    expect(result.didDocument?.id).toBe(DID)
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledWith(DID_URL, { redirect: 'manual' })
  })

  it('rejects a did:web redirect without following it', async () => {
    const fetchImplementation = vi.fn(
      async () => ({ status: 302, redirected: false, url: DID_URL }) as unknown as Response,
    )
    const resolver = new CachedWebDidResolver({ publicApiBaseUrl: 'https://agent.example' })

    const result = await resolver.resolve(
      resolverContext(fetchImplementation),
      DID,
      { did: DID, method: 'web', id: 'issuer.example' } as never,
      {},
    )

    expect(result.didDocument).toBeNull()
    expect(result.didResolutionMetadata.error).toBe('notFound')
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(fetchImplementation).toHaveBeenCalledWith(DID_URL, { redirect: 'manual' })
  })
})
