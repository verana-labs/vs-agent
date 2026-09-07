import { configureChainIndexers, mapToEcosystem } from '@verana-labs/vs-agent-model'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { addDigestSRI, generateDigestSRI } from '../src/utils/setupSelfTr'

const ID = 'https://agent.example/vt/cs/v1/js/ecs-org'
const SCHEMA = '{"$id":"https://agent.example/vt/cs/v1/js/ecs-org","type":"object"}'
const ecsSchemas = { 'ecs-org': SCHEMA }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapToEcosystem', () => {
  it('resolves VPR references through the built-in or configured indexer and leaves URLs untouched', () => {
    configureChainIndexers({
      'vna-demo-1': 'https://idx.demo.example/',
      'vna-devnet-1': 'https://idx.internal.example',
    })

    expect(mapToEcosystem('vpr:verana:vna-testnet-1:cs:12')).toBe(
      'https://idx.testnet.verana.network/v4/credential-schema/js/12',
    )
    expect(mapToEcosystem('vpr:verana:vna-demo-1:cs:9')).toBe(
      'https://idx.demo.example/v4/credential-schema/js/9',
    )
    expect(mapToEcosystem('vpr:verana:vna-devnet-1:cs:3')).toBe(
      'https://idx.internal.example/v4/credential-schema/js/3',
    )
    expect(mapToEcosystem(ID)).toBe(ID)
  })

  it('throws for VPR references it cannot resolve', () => {
    configureChainIndexers({ 'vna-empty-1': undefined })

    expect(() => mapToEcosystem('vpr:verana:vna-empty-1:cs:1')).toThrow(
      /No indexer configured for chain "vna-empty-1"/,
    )
    expect(() => mapToEcosystem('vpr:verana:vna-testnet-1/cs/v1/js/12')).toThrow(
      /Malformed VPR schema reference/,
    )
  })
})

describe('addDigestSRI', () => {
  it('digests the fetched schema, falling back to the local one on any fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(SCHEMA, { status: 200 })),
    )
    expect((await addDigestSRI(ID, { id: 'x' })).digestSRI).toBe(generateDigestSRI(SCHEMA))

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' })),
    )
    expect((await addDigestSRI(ID, { id: 'x' }, ecsSchemas)).digestSRI).toBe(generateDigestSRI(SCHEMA))

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    expect((await addDigestSRI(ID, { id: 'x' }, ecsSchemas)).digestSRI).toBe(generateDigestSRI(SCHEMA))
  })

  it('reports the resolution failure when there is no local fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(SCHEMA, { status: 200 })),
    )

    await expect(addDigestSRI('vpr:verana:vna-unconfigured-1:cs:9', { id: 'x' })).rejects.toThrow(
      /No indexer configured for chain "vna-unconfigured-1"/,
    )
  })
})
