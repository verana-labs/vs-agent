import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveJsonSchemaCredentialId } from '../src/utils/vtjscResolver'

const AGENT_DID = 'did:web:issuer.example'
const ECOSYSTEM_DID = 'did:web:ecosystem.example'
const CHAIN_ID = 'vna-devnet-1'
const SCHEMA_ID = 5
const SCHEMA_REF = `vpr:verana:${CHAIN_ID}:cs:${SCHEMA_ID}`
const JSC_ID = 'https://ecosystem.example/vt/schemas-5-jsc.json'
const VP_URL = 'https://ecosystem.example/vt/schemas-5-vtjsc-vp.json'
const SERVICE_ID = `${ECOSYSTEM_DID}#vpr-schemas-${SCHEMA_ID}-vtjsc-vp`

function makeAgent(options: { jsc?: Record<string, unknown>; service?: Record<string, unknown> } = {}) {
  const metadata = new Map<string, Record<string, unknown>>()
  if (options.jsc) metadata.set('_vt/jsc', options.jsc)
  const resolve = vi.fn(async () => ({
    didDocument: { service: options.service ? [options.service] : [] },
  }))
  return {
    did: AGENT_DID,
    dids: {
      getCreatedDids: async () => [{ did: AGENT_DID, metadata: { get: (k: string) => metadata.get(k) } }],
      resolve,
    },
    resolve,
  }
}

function makeIndexer() {
  return {
    getCredentialSchema: vi.fn(async () => ({ id: SCHEMA_ID, ecosystem_id: 9 })),
    getEcosystem: vi.fn(async () => ({ id: 9, did: ECOSYSTEM_DID })),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveJsonSchemaCredentialId', () => {
  it('answers from the local record when this agent controls the Ecosystem', async () => {
    const agent = makeAgent({
      jsc: { [SCHEMA_REF]: { verifiablePresentation: { verifiableCredential: [{ id: JSC_ID }] } } },
    })
    const indexer = makeIndexer()

    const id = await resolveJsonSchemaCredentialId(agent as never, indexer as never, SCHEMA_ID, CHAIN_ID)

    expect(id).toBe(JSC_ID)
    // It publishes the VTJSC itself, so it needs no chain lookup and no network call.
    expect(indexer.getEcosystem).not.toHaveBeenCalled()
    expect(agent.resolve).not.toHaveBeenCalled()
  })

  it('follows the Ecosystem DID Document when the issuer holds no local copy', async () => {
    const agent = makeAgent({
      service: { id: SERVICE_ID, type: 'LinkedVerifiablePresentation', serviceEndpoint: VP_URL },
    })
    const indexer = makeIndexer()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ verifiableCredential: [{ id: JSC_ID }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await resolveJsonSchemaCredentialId(agent as never, indexer as never, SCHEMA_ID, CHAIN_ID)

    expect(id).toBe(JSC_ID)
    expect(agent.resolve).toHaveBeenCalledWith(ECOSYSTEM_DID)
    expect(fetchMock).toHaveBeenCalledWith(VP_URL, expect.objectContaining({ signal: expect.anything() }))
  })

  it('fails when the Ecosystem publishes no VTJSC for the schema', async () => {
    const agent = makeAgent({ service: { id: `${ECOSYSTEM_DID}#other`, serviceEndpoint: VP_URL } })
    const indexer = makeIndexer()

    await expect(
      resolveJsonSchemaCredentialId(agent as never, indexer as never, SCHEMA_ID, CHAIN_ID),
    ).rejects.toThrow('publishes no VTJSC')
  })

  it('fails when the published presentation carries no credential', async () => {
    const agent = makeAgent({
      service: { id: SERVICE_ID, type: 'LinkedVerifiablePresentation', serviceEndpoint: VP_URL },
    })
    const indexer = makeIndexer()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    )

    await expect(
      resolveJsonSchemaCredentialId(agent as never, indexer as never, SCHEMA_ID, CHAIN_ID),
    ).rejects.toThrow('carries no credential')
  })
})
