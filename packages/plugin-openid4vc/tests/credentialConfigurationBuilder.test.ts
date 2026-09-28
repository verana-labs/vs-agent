import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ParticipantRole, ParticipantState } from '@verana-labs/vs-agent-sdk'

import { buildCredentialConfigurations } from '../src/services/credentialConfigurationBuilder'

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

function fakeAgent(indexer: ReturnType<typeof fakeIndexer>, overrides: Record<string, unknown> = {}) {
  const jsc = Object.fromEntries(
    Object.keys(SCHEMAS).map(schemaId => [
      `vpr:verana:${CHAIN_ID}:cs:${schemaId}`,
      { verifiablePresentation: { verifiableCredential: [{ id: `https://vtjsc.example/${schemaId}` }] } },
    ]),
  )

  return {
    did: AGENT_DID,
    veranaChain: { getChainId: CHAIN_ID },
    config: { logger },
    indexer,
    dids: {
      getCreatedDids: vi
        .fn()
        .mockResolvedValue([{ metadata: { get: (key: string) => (key === '_vt/jsc' ? jsc : undefined) } }]),
    },
    ...overrides,
  } as unknown as VsAgent
}

describe('buildCredentialConfigurations', () => {
  beforeEach(() => vi.clearAllMocks())

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
        claims: ['id', 'tier'],
        disclosureFrame: ['id', 'tier'],
      },
    ])
  })

  it('skips a schema it cannot resolve and keeps the rest', async () => {
    const configurations = await buildCredentialConfigurations(fakeAgent(fakeIndexer([1, 3])))

    expect(configurations?.map(configuration => configuration.credentialSchemaId)).toEqual([1])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the CredentialSchema 3'))
  })

  it('skips a schema whose credentialSubject declares a reserved SD-JWT VC claim', async () => {
    const configurations = await buildCredentialConfigurations(fakeAgent(fakeIndexer([1, 4])))

    expect(configurations?.map(configuration => configuration.credentialSchemaId)).toEqual([1])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the JSON Schema declares the reserved SD-JWT VC claim 'vct'"),
    )
  })

  it('derives an empty set from an empty participant list', async () => {
    const indexer = fakeIndexer([])

    await expect(buildCredentialConfigurations(fakeAgent(indexer))).resolves.toEqual([])
    expect(indexer.getCredentialSchema).not.toHaveBeenCalled()
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
