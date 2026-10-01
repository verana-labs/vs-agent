import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  ParticipantRole,
  ParticipantState,
} from '@verana-labs/vs-agent-sdk'

import {
  buildCredentialConfigurations,
  resolveCredentialType,
} from '../src/services/credentialConfigurationBuilder'

const AGENT_DID = 'did:web:issuer.example'
const CHAIN_ID = 'vpr-test-1'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const jsonSchema = (title: string, properties: Record<string, unknown>) =>
  JSON.stringify({ title, type: 'object', properties: { credentialSubject: { type: 'object', properties } } })

const SCHEMAS: Record<number, { ecosystem_id: number; json_schema: string }> = {
  1: {
    ecosystem_id: 10,
    json_schema: jsonSchema('Employee credential', { name: { type: 'string' }, role: { type: 'string' } }),
  },
  2: {
    ecosystem_id: 10,
    json_schema: jsonSchema('Membership credential', { id: { type: 'string' }, tier: { type: 'string' } }),
  },
  3: {
    ecosystem_id: 20,
    json_schema: jsonSchema('Unreachable credential', { name: { type: 'string' } }),
  },
  4: {
    ecosystem_id: 10,
    json_schema: jsonSchema('Envelope credential', { name: { type: 'string' }, vct: { type: 'string' } }),
  },
  5: {
    ecosystem_id: 10,
    json_schema: JSON.stringify({
      type: 'object',
      properties: { credentialSubject: { type: 'object', properties: { name: { type: 'string' } } } },
    }),
  },
}

const ECOSYSTEMS: Record<number, string> = { 10: 'did:web:ecosystem.example', 20: 'did:example:ecosystem' }

function fakeIndexer(schemaIds: number[]) {
  return {
    listParticipants: vi.fn().mockResolvedValue(
      schemaIds.map((schema_id, index) => ({
        id: index + 1,
        schema_id,
        did: AGENT_DID,
        role: ParticipantRole.Issuer,
        participant_state: ParticipantState.Active,
        revoked: null,
        slashed: null,
        modified: '2026-09-01T00:00:00.000Z',
      })),
    ),
    getCredentialSchema: vi.fn(async (id: number) => ({ id: Number(id), ...SCHEMAS[Number(id)] })),
    getEcosystem: vi.fn(async (id: number) => ({ id: Number(id), did: ECOSYSTEMS[Number(id)] })),
  }
}

// The issuer does not control the Ecosystem, so it reads each VTJSC from the Ecosystem DID Document.
function fakeAgent(indexer: ReturnType<typeof fakeIndexer>, overrides: Record<string, unknown> = {}) {
  const service = Object.keys(SCHEMAS).map(schemaId => ({
    id: `${ECOSYSTEMS[10]}#vpr-schemas-${schemaId}-vtjsc-vp`,
    serviceEndpoint: `https://ecosystem.example/vt/jsc/${schemaId}`,
  }))

  return {
    did: AGENT_DID,
    veranaChain: { getChainId: CHAIN_ID },
    config: { logger },
    indexer,
    dids: { resolve: vi.fn().mockResolvedValue({ didDocument: { service } }) },
    ...overrides,
  } as unknown as VsAgent
}

function fakeVtjscFetch() {
  return vi.fn(async (url: string) => {
    const schemaId = url.split('/').pop()
    return new Response(
      JSON.stringify({ verifiableCredential: [{ id: `https://vtjsc.example/${schemaId}` }] }),
    )
  })
}

describe('buildCredentialConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fakeVtjscFetch())
  })

  afterEach(() => vi.unstubAllGlobals())

  it('builds one configuration per CredentialSchema of an active ISSUER participant', async () => {
    const indexer = fakeIndexer([1, 2])

    const configurations = await buildCredentialConfigurations(fakeAgent(indexer))

    expect(indexer.listParticipants).toHaveBeenCalledWith({
      did: AGENT_DID,
      role: ParticipantRole.Issuer,
      participantState: ParticipantState.Active,
    })
    expect(configurations).toEqual([
      {
        id: 'https://vtjsc.example/1',
        format: 'dc+sd-jwt',
        vct: 'https://ecosystem.example/vt/vct/1',
        name: 'Employee credential',
        vtjscId: 'https://vtjsc.example/1',
        credentialSchemaId: 1,
        jsonSchema: SCHEMAS[1].json_schema,
        claims: ['name', 'role'],
        disclosureFrame: ['name', 'role'],
      },
      {
        id: 'https://vtjsc.example/2',
        format: 'dc+sd-jwt',
        vct: 'https://ecosystem.example/vt/vct/2',
        name: 'Membership credential',
        vtjscId: 'https://vtjsc.example/2',
        credentialSchemaId: 2,
        jsonSchema: SCHEMAS[2].json_schema,
        claims: ['tier'],
        disclosureFrame: ['tier'],
      },
    ])
  })

  it('skips a schema it cannot resolve and keeps the rest', async () => {
    const configurations = await buildCredentialConfigurations(fakeAgent(fakeIndexer([1, 3])))

    expect(configurations?.map(configuration => configuration.credentialSchemaId)).toEqual([1])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the CredentialSchema 3'))
  })

  it('advertises a schema declaring an envelope claim, without that claim', async () => {
    const configurations = await buildCredentialConfigurations(fakeAgent(fakeIndexer([4])))

    expect(configurations?.map(configuration => configuration.claims)).toEqual([['name']])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the CredentialSchema 4 declares 'vct', which the credential envelope carries"),
    )
  })

  it('offers no id claim, which the holder key of the credential answers for', async () => {
    const configurations = await buildCredentialConfigurations(fakeAgent(fakeIndexer([2])))

    expect(configurations?.[0].claims).toEqual(['tier'])
    expect(configurations?.[0].disclosureFrame).toEqual(['tier'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the CredentialSchema 2 declares 'id', which the credential envelope carries"),
    )
  })

  it('names a title-less schema after its on-chain reference, the way the served document does', async () => {
    const configurations = await buildCredentialConfigurations(fakeAgent(fakeIndexer([5])))

    expect(configurations?.[0].name).toBe(`vpr:verana:${CHAIN_ID}:cs:5`)
    expect(configurations?.[0].claims).toEqual(['name'])
  })

  it('reads each CredentialSchema and each Ecosystem of a rebuild once', async () => {
    const indexer = fakeIndexer([1, 2])

    await buildCredentialConfigurations(fakeAgent(indexer))

    expect(indexer.getCredentialSchema).toHaveBeenCalledTimes(2)
    expect(indexer.getEcosystem).toHaveBeenCalledTimes(1)
  })

  it('resolves the VTJSC of the Ecosystem from the reads it already made', async () => {
    const indexer = fakeIndexer([1])
    const agent = fakeAgent(indexer, {
      dids: {
        getCreatedDids: vi.fn().mockResolvedValue([]),
        resolve: vi.fn().mockResolvedValue({
          didDocument: {
            service: [
              {
                id: 'did:web:ecosystem.example#vpr-schemas-1-vtjsc-vp',
                serviceEndpoint: 'https://ecosystem.example/vt/jsc/1',
              },
            ],
          },
        }),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ verifiableCredential: [{ id: 'vtjsc:1' }] }))),
    )

    const configurations = await buildCredentialConfigurations(agent)

    expect(configurations?.[0].id).toBe('vtjsc:1')
    expect(indexer.getCredentialSchema).toHaveBeenCalledOnce()
    expect(indexer.getEcosystem).toHaveBeenCalledOnce()
  })

  it('derives an empty set from an empty participant list', async () => {
    const indexer = fakeIndexer([])

    await expect(buildCredentialConfigurations(fakeAgent(indexer))).resolves.toEqual([])
    expect(indexer.getCredentialSchema).not.toHaveBeenCalled()
  })

  it('says an empty participant list leaves no credential type to issue', async () => {
    const indexer = fakeIndexer([])

    await buildCredentialConfigurations(fakeAgent(indexer))

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('no credential type to issue'))
  })

  it('derives no set at all without an agent DID or a chain', async () => {
    const indexer = fakeIndexer([1])

    await expect(
      buildCredentialConfigurations(fakeAgent(indexer, { did: undefined })),
    ).resolves.toBeUndefined()
    await expect(
      buildCredentialConfigurations(fakeAgent(indexer, { veranaChain: undefined })),
    ).resolves.toBeUndefined()
    expect(indexer.listParticipants).not.toHaveBeenCalled()
  })
})

describe('resolveCredentialType', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves the type of a VTJSC through its CredentialSchema link', async () => {
    const indexer = fakeIndexer([])
    const anonCredsTrust = {
      resolveCredentialSchemaLink: vi
        .fn()
        .mockResolvedValue({ credentialSchemaId: 1, ecosystemDid: ECOSYSTEMS[10] }),
    }

    const configuration = await resolveCredentialType(
      fakeAgent(indexer, { anonCredsTrust }),
      'https://vtjsc.example/1',
    )

    expect(anonCredsTrust.resolveCredentialSchemaLink).toHaveBeenCalledWith('https://vtjsc.example/1')
    expect(configuration).toMatchObject({
      id: 'https://vtjsc.example/1',
      vct: 'https://ecosystem.example/vt/vct/1',
      credentialSchemaId: 1,
      claims: ['name', 'role'],
    })
    expect(indexer.listParticipants).not.toHaveBeenCalled()
  })

  it('passes the error of a VTJSC that binds to no CredentialSchema through', async () => {
    const anonCredsTrust = {
      resolveCredentialSchemaLink: vi
        .fn()
        .mockRejectedValue(new AnonCredsTrustError(AnonCredsTrustErrorReason.NotDerivable, 'binds to none')),
    }

    await expect(
      resolveCredentialType(fakeAgent(fakeIndexer([]), { anonCredsTrust }), 'https://vtjsc.example/9'),
    ).rejects.toMatchObject({ reason: AnonCredsTrustErrorReason.NotDerivable })
  })
})
