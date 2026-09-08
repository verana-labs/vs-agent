import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishVtjscIfOwner, reconcileVtjscPublications } from '../src/blockchain/handlers/stateMutations'
import { VeranaSyncState } from '../src/blockchain/types'
import { generateDigestSRI } from '../src/utils/setupSelfTr'

const CHAIN_ID = 'vna-demo-1'
const schemaRef = (schemaId: number | string) => `vpr:verana:${CHAIN_ID}:cs:${schemaId}`
const jscId = (schemaId: number | string) => `https://agent.example/vt/schemas-${schemaId}-jsc.json`

/** A JSON Schema shaped as [VSA-PUB-AC-5] reads it: `title` names the schema, `credentialSubject` lists its attributes. */
const jsonSchema = (title: string) =>
  JSON.stringify({ title, properties: { credentialSubject: { properties: { name: {} } } } })

const createJsc = vi.fn()
const detachVtjscPublications = vi.fn(async (_agent: unknown, refs: readonly string[]) => [...refs])
const reattachVtjscPublication = vi.fn(async () => false)

vi.mock('../src/utils/trustCredentialStore', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils/trustCredentialStore')>()),
  createJsc: (...args: unknown[]) => createJsc(...args),
  detachVtjscPublications: (...args: unknown[]) => detachVtjscPublications(args[0], args[1] as string[]),
  reattachVtjscPublication: (...args: unknown[]) => reattachVtjscPublication(...(args as [])),
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

function makeAnonCreds() {
  return {
    getCreatedSchemas: vi.fn(async () => []),
    registerSchema: vi.fn(async () => ({
      schemaState: { state: 'finished', schemaId: 'did:webvh:QmEco:agent.example/resources/zQmSchema' },
      registrationMetadata: { attestedResource: { id: 'zQmSchema' } },
    })),
  }
}

function makeAgent() {
  const anoncreds = makeAnonCreds()
  return {
    anoncreds,
    agent: {
      did: 'did:webvh:QmEco:agent.example',
      context: {},
      config: { logger: makeLogger() },
      publicApiBaseUrl: 'https://agent.example',
      veranaChain: { getChainId: CHAIN_ID },
      modules: { anoncreds },
      genericRecords: { save: vi.fn() },
      dependencyManager: { resolve: () => ({ findBySchemaId: vi.fn(async () => null) }) },
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
      '5': { id: 5, ecosystemId: 1, jsonSchema: jsonSchema('x'), lastModifiedBlock: 10 },
    },
    participants: {},
  } as unknown as VeranaSyncState
}

describe('publishVtjscIfOwner', () => {
  beforeEach(() => {
    createJsc.mockReset()
    createJsc.mockResolvedValue({ id: jscId(5) })
  })

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

  it('publishes the AnonCreds schema of the VTJSC it just published', async () => {
    const { agent, anoncreds } = makeAgent()
    await publishVtjscIfOwner(stateWith(7), agent as never, '5', 7)

    expect(anoncreds.registerSchema).toHaveBeenCalledWith({
      schema: { attrNames: ['name'], name: 'x', version: '5', issuerId: agent.did },
      options: { extraMetadata: { relatedJsonSchemaCredentialId: jscId(5) } },
    })
  })

  it('registers no second schema when the VTJSC already has one', async () => {
    const { agent, anoncreds } = makeAgent()
    anoncreds.getCreatedSchemas.mockResolvedValue([{ schemaId: 'zQmAlready' }] as never)

    await publishVtjscIfOwner(stateWith(7), agent as never, '5', 7)

    expect(anoncreds.getCreatedSchemas).toHaveBeenCalledWith({ relatedJsonSchemaCredentialId: jscId(5) })
    expect(anoncreds.registerSchema).not.toHaveBeenCalled()
  })

  it('keeps the schemas of two VTJSCs apart when both derive the same name and attributes', async () => {
    const { agent, anoncreds } = makeAgent()
    const state = stateWith(7)
    state.credentialSchemas['6'] = {
      ...state.credentialSchemas['5'],
      id: 6,
    }

    createJsc.mockResolvedValueOnce({ id: jscId(5) }).mockResolvedValueOnce({ id: jscId(6) })
    await publishVtjscIfOwner(state, agent as never, '5', 7)
    await publishVtjscIfOwner(state, agent as never, '6', 7)

    expect(anoncreds.registerSchema).toHaveBeenCalledWith({
      schema: { attrNames: ['name'], name: 'x', version: '5', issuerId: agent.did },
      options: { extraMetadata: { relatedJsonSchemaCredentialId: jscId(5) } },
    })
    expect(anoncreds.registerSchema).toHaveBeenCalledWith({
      schema: { attrNames: ['name'], name: 'x', version: '6', issuerId: agent.did },
      options: { extraMetadata: { relatedJsonSchemaCredentialId: jscId(6) } },
    })
  })

  it('publishes no schema for an ecosystem of another corporation', async () => {
    const { agent, anoncreds } = makeAgent()
    await publishVtjscIfOwner(stateWith(8), agent as never, '5', 7)
    expect(anoncreds.registerSchema).not.toHaveBeenCalled()
  })
})

/** Holds the given `_vt/jsc` keys. A key listed in `digests` reads as current, not to rebuild. */
function agentPublishing(jscKeys: string[], digests: Record<string, string> = {}) {
  const metadata = Object.fromEntries(
    jscKeys.map(key => [
      key,
      {
        credential: { id: jscId(key.split(':').pop()!), credentialSubject: { digestSRI: digests[key] } },
        didDocumentServiceId: `#${key}`,
      },
    ]),
  )
  const anoncreds = makeAnonCreds()
  return {
    did: 'did:web:agent.example',
    context: {},
    publicApiBaseUrl: 'https://agent.example',
    config: { logger: makeLogger() },
    veranaChain: { getChainId: CHAIN_ID },
    metadata,
    anoncreds,
    modules: { anoncreds },
    genericRecords: { save: vi.fn() },
    dependencyManager: { resolve: () => ({ findBySchemaId: vi.fn(async () => null) }) },
    dids: {
      getCreatedDids: async () => [
        { metadata: { get: () => metadata, set: vi.fn() }, didDocument: { service: [] } },
      ],
    },
  }
}

/** Ecosystem 1 is the agent's, 2 moved to another corporation, 3 is the agent's but archived. */
function makeIndexer(overrides: Record<string, unknown> = {}) {
  const ecosystems: Record<string, unknown> = {
    '1': { id: 1, did: 'did:web:agent.example', corporation_id: 7, archived: null },
    '2': { id: 2, did: 'did:web:other.example', corporation_id: 8, archived: null },
    '3': { id: 3, did: 'did:web:agent.example', corporation_id: 7, archived: '2026-01-01T00:00:00Z' },
  }
  const schemas: Record<string, unknown> = {
    '5': { id: 5, ecosystem_id: 1, json_schema: jsonSchema('kept') },
    '9': { id: 9, ecosystem_id: 2, json_schema: jsonSchema('other-corp') },
    '11': { id: 11, ecosystem_id: 3, json_schema: jsonSchema('archived') },
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
    detachVtjscPublications.mockClear()
    reattachVtjscPublication.mockClear()
  })

  it('detaches the VTJSC of an ecosystem that moved to another corporation, and keeps its own', async () => {
    const agent = agentPublishing([schemaRef(5), schemaRef(9)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(detachVtjscPublications).toHaveBeenCalledWith(expect.anything(), [schemaRef(9)])
  })

  it('detaches without dropping the entry, so the VTJSC keeps being served', async () => {
    // Issued credentials name this VTJSC in `credentialSchema.id`; losing the entry would 404 it.
    const agent = agentPublishing([schemaRef(9)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(Object.keys(agent.metadata)).toContain(schemaRef(9))
  })

  it('leaves an archived ecosystem of its own corporation alone', async () => {
    // The agent still controls it, and [VSA-VTI-NOTIF-ES] gives ArchiveEcosystem no handler.
    const agent = agentPublishing([schemaRef(5), schemaRef(11)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(detachVtjscPublications).not.toHaveBeenCalled()
    expect(Object.keys(agent.metadata)).toContain(schemaRef(11))
  })

  it('re-attaches a detached VTJSC once the ecosystem is under its corporation again', async () => {
    // The digest still matches, so the publication pass skips createJsc and announces nothing.
    reattachVtjscPublication.mockResolvedValueOnce(true)
    const agent = agentPublishing([schemaRef(5)], {
      [schemaRef(5)]: generateDigestSRI(jsonSchema('kept')),
    })
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(reattachVtjscPublication).toHaveBeenCalledWith(expect.anything(), schemaRef(5))
    expect(createJsc).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ schemaBaseId: '5' }),
    )
  })

  it('publishes the AnonCreds schema of a VTJSC that was published without one', async () => {
    reattachVtjscPublication.mockResolvedValueOnce(true)
    const agent = agentPublishing([schemaRef(5)], {
      [schemaRef(5)]: generateDigestSRI(jsonSchema('kept')),
    })
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(createJsc).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ schemaBaseId: '5' }),
    )
    expect(agent.anoncreds.registerSchema).toHaveBeenCalledWith({
      schema: { attrNames: ['name'], name: 'kept', version: '5', issuerId: agent.did },
      options: { extraMetadata: { relatedJsonSchemaCredentialId: jscId(5) } },
    })
  })

  it('never touches the self-issued schema credentials stored in the same bucket', async () => {
    const selfTrKey = 'https://agent.example/vt/schemas-example-service-jsc.json'
    const agent = agentPublishing([selfTrKey, schemaRef(9)])
    await reconcileVtjscPublications(agent as never, makeIndexer() as never, 7)

    expect(detachVtjscPublications).toHaveBeenCalledWith(expect.anything(), [schemaRef(9)])
  })

  it('keeps an entry the VPR cannot answer for, rather than reading silence as a loss of control', async () => {
    const agent = agentPublishing([schemaRef(9)])
    const indexer = makeIndexer({
      getCredentialSchema: vi.fn(async () => {
        throw new Error('indexer unreachable')
      }),
    })
    await reconcileVtjscPublications(agent as never, indexer as never, 7)

    expect(detachVtjscPublications).not.toHaveBeenCalled()
  })

  it('keeps every entry attached when the ecosystem list comes back truncated', async () => {
    // Nothing is reconciled, so a diff-based pass would detach schema 5 here.
    const agent = agentPublishing([schemaRef(5)])
    const indexer = makeIndexer({ listEcosystems: vi.fn(async () => []) })
    await reconcileVtjscPublications(agent as never, indexer as never, 7)

    expect(detachVtjscPublications).not.toHaveBeenCalled()
  })
})
