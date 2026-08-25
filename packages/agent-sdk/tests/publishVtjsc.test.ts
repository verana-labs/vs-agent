import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishVtjscIfOwner, reconcileVtjscPublications } from '../src/blockchain/handlers/stateMutations'
import { VeranaSyncState } from '../src/blockchain/types'

const CHAIN_ID = 'vna-demo-1'
const schemaRef = (schemaId: number | string) => `vpr:verana:${CHAIN_ID}:cs:${schemaId}`

const createJsc = vi.fn()
const withdrawVtjscPublications = vi.fn(async (_agent: unknown, refs: readonly string[]) => [...refs])

vi.mock('../src/utils/trustCredentialStore', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils/trustCredentialStore')>()),
  createJsc: (...args: unknown[]) => createJsc(...args),
  withdrawVtjscPublications: (...args: unknown[]) => withdrawVtjscPublications(args[0], args[1] as string[]),
}))

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }
}

function makeAgent() {
  return {
    agent: {
      config: { logger: makeLogger() },
      publicApiBaseUrl: 'https://agent.example',
      veranaChain: { getChainId: CHAIN_ID },
    },
  }
}

function stateWith(ecosystemCorporationId: number): VeranaSyncState {
  return {
    lastBlockHeight: 10,
    ecosystems: {
      '1': {
        id: 1,
        did: 'did:example:eco',
        corporationId: ecosystemCorporationId,
        archived: false,
        lastModifiedBlock: 10,
      },
    },
    credentialSchemas: {
      '5': { id: 5, ecosystemId: 1, jsonSchema: '{"title":"x"}', lastModifiedBlock: 10 },
    },
    participants: {},
  } as unknown as VeranaSyncState
}

describe('publishVtjscIfOwner', () => {
  beforeEach(() => createJsc.mockReset())

  it('publishes a schema owned by the agent corporation', async () => {
    const { agent } = makeAgent()
    await publishVtjscIfOwner(stateWith(7), agent as never, '5', 7)
    expect(createJsc).toHaveBeenCalledTimes(1)
  })

  it('skips a schema owned by another corporation', async () => {
    const { agent } = makeAgent()
    await publishVtjscIfOwner(stateWith(8), agent as never, '5', 7)
    expect(createJsc).not.toHaveBeenCalled()
  })

  it('skips publication when the agent is not connected to a chain', async () => {
    const { agent } = makeAgent()
    await publishVtjscIfOwner(stateWith(7), { ...agent, veranaChain: undefined } as never, '5', 7)
    expect(createJsc).not.toHaveBeenCalled()
  })

  it('returns without throwing when the schema is not in state', async () => {
    const { agent } = makeAgent()
    await expect(publishVtjscIfOwner(stateWith(7), agent as never, '404', 7)).resolves.toBeUndefined()
    expect(createJsc).not.toHaveBeenCalled()
  })
})

/** Holds the given `_vt/jsc` keys, so the reconciliation pass has something to withdraw. */
function agentPublishing(jscKeys: string[]) {
  const metadata = Object.fromEntries(
    jscKeys.map(key => [key, { credential: { credentialSubject: {} }, didDocumentServiceId: `#${key}` }]),
  )
  return {
    did: 'did:web:agent.example',
    publicApiBaseUrl: 'https://agent.example',
    config: { logger: makeLogger() },
    veranaChain: { getChainId: CHAIN_ID },
    dids: {
      getCreatedDids: async () => [
        { metadata: { get: () => metadata, set: vi.fn() }, didDocument: { service: [] } },
      ],
    },
  }
}

/** Ecosystem 1 is the agent's, 2 moved to another corporation, 3 is archived. */
function makeIndexer(overrides: Record<string, unknown> = {}) {
  const ecosystems: Record<string, unknown> = {
    '1': { id: 1, did: 'did:web:agent.example', corporation_id: 7, archived: null },
    '2': { id: 2, did: 'did:web:other.example', corporation_id: 8, archived: null },
    '3': { id: 3, did: 'did:web:agent.example', corporation_id: 7, archived: '2026-01-01T00:00:00Z' },
  }
  const schemas: Record<string, unknown> = {
    '5': { id: 5, ecosystem_id: 1, json_schema: '{"title":"kept"}' },
    '9': { id: 9, ecosystem_id: 2, json_schema: '{"title":"other-corp"}' },
    '11': { id: 11, ecosystem_id: 3, json_schema: '{"title":"archived"}' },
  }
  return {
    listEcosystems: vi.fn(async () => Object.values(ecosystems)),
    listCredentialSchemas: vi.fn(async (ecosystemId: number) =>
      Object.values(schemas).filter(s => (s as { ecosystem_id: number }).ecosystem_id === ecosystemId),
    ),
    getCredentialSchema: vi.fn(async (id: string) => {
      const schema = schemas[String(id)]
      if (!schema) throw new Error(`schema ${id} not found`)
      return schema
    }),
    getEcosystem: vi.fn(async (id: string) => ecosystems[String(id)]),
    listParticipants: vi.fn(async () => []),
    ...overrides,
  }
}

describe('reconcileVtjscPublications', () => {
  beforeEach(() => {
    createJsc.mockReset()
    withdrawVtjscPublications.mockClear()
  })

  it('withdraws the VTJSC of an ecosystem that moved to another corporation, and keeps its own', async () => {
    const agent = agentPublishing([schemaRef(5), schemaRef(9)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(withdrawVtjscPublications).toHaveBeenCalledWith(expect.anything(), [schemaRef(9)])
  })

  it('withdraws the VTJSC of an archived ecosystem, and does not republish it', async () => {
    const agent = agentPublishing([schemaRef(5), schemaRef(11)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(withdrawVtjscPublications).toHaveBeenCalledWith(expect.anything(), [schemaRef(11)])
    // Without the archived filter on the publication pass, one run would create the entry and the
    // withdrawal pass would drop it again, on every reconciliation.
    const published = createJsc.mock.calls.map(call => (call[3] as { schemaBaseId: string }).schemaBaseId)
    expect(published).not.toContain('11')
  })

  it('never touches the self-issued schema credentials stored in the same bucket', async () => {
    const selfTrKey = 'https://agent.example/vt/schemas-example-service-jsc.json'
    const agent = agentPublishing([selfTrKey, schemaRef(9)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(withdrawVtjscPublications).toHaveBeenCalledWith(expect.anything(), [schemaRef(9)])
  })

  it('keeps an entry the VPR cannot answer for, rather than reading silence as a loss of control', async () => {
    const agent = agentPublishing([schemaRef(9)])
    const indexer = makeIndexer({
      getCredentialSchema: vi.fn(async () => {
        throw new Error('indexer unreachable')
      }),
    })
    await reconcileVtjscPublications(agent as never, indexer as never, 7)

    expect(withdrawVtjscPublications).not.toHaveBeenCalled()
  })

  it('keeps every entry when the ecosystem list comes back truncated', async () => {
    // Nothing is reconciled, so a delete-by-difference pass would withdraw schema 5 here.
    const agent = agentPublishing([schemaRef(5)])
    const indexer = makeIndexer({ listEcosystems: vi.fn(async () => []) })
    await reconcileVtjscPublications(agent as never, indexer as never, 7)

    expect(withdrawVtjscPublications).not.toHaveBeenCalled()
  })
})
