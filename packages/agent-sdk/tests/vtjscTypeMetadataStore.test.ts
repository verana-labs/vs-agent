import { describe, expect, it, vi } from 'vitest'

import {
  findVtjscTypeMetadata,
  saveMetadataEntry,
  saveVtjscTypeMetadata,
} from '../src/utils/trustCredentialStore'

const CHAIN_ID = 'vna-testnet-1'
const schemaRef = (id: number) => `vpr:verana:${CHAIN_ID}:cs:${id}`
const bytes = (id: number) => `{"vct":"https://agent.example/vt/vct/${id}"}`

/** A DID record whose `_vt/jsc` bucket holds the given entries, as the agent stores them. */
function didRecordWith(entries: Record<string, Record<string, unknown>>) {
  return {
    did: 'did:web:agent.example',
    didDocument: { id: 'did:web:agent.example', service: [] },
    metadata: { get: () => entries, set: vi.fn() },
  }
}

function agentWith(didRecord: ReturnType<typeof didRecordWith>) {
  return {
    context: { dependencyManager: { resolve: () => ({ update: vi.fn() }) } },
    dids: { getCreatedDids: async () => [didRecord], update: vi.fn() },
  }
}

describe('saveVtjscTypeMetadata', () => {
  it('stores the document once and keeps the first bytes, which issuers hashed', async () => {
    const entries: Record<string, Record<string, unknown>> = {
      [schemaRef(144)]: { didDocumentServiceId: '#s' },
    }
    const agent = agentWith(didRecordWith(entries))

    await expect(saveVtjscTypeMetadata(agent as never, schemaRef(144), bytes(144))).resolves.toBe(true)
    await expect(saveVtjscTypeMetadata(agent as never, schemaRef(144), '{"vct":"other"}')).resolves.toBe(
      false,
    )

    expect(entries[schemaRef(144)].typeMetadata).toBe(bytes(144))
  })
})

describe('saveMetadataEntry', () => {
  it('keeps the stored Type Metadata when the VTJSC of the schema is issued again', async () => {
    const entries: Record<string, Record<string, unknown>> = {
      [schemaRef(144)]: { didDocumentServiceId: '#s', typeMetadata: bytes(144) },
    }
    const didRecord = didRecordWith(entries)
    const credential = {
      id: 'https://agent.example/vt/schemas-144-jsc.json',
      credentialSubject: { id: schemaRef(144) },
    }
    const presentation = { id: 'https://agent.example/vt/schemas-144-jsc-vp.json' }

    await saveMetadataEntry(
      agentWith(didRecord) as never,
      didRecord as never,
      credential as never,
      presentation as never,
      '#s',
      '_vt/jsc',
    )

    expect(entries[schemaRef(144)].typeMetadata).toBe(bytes(144))
  })
})

describe('findVtjscTypeMetadata', () => {
  const didRecord = didRecordWith({
    [schemaRef(144)]: { typeMetadata: bytes(144) },
    [schemaRef(1440)]: { typeMetadata: bytes(1440) },
  })

  it('answers the schema of the chain the agent syncs and nothing else', () => {
    expect(findVtjscTypeMetadata(didRecord as never, CHAIN_ID, '144')).toBe(bytes(144))
    expect(findVtjscTypeMetadata(didRecord as never, CHAIN_ID, '14')).toBeUndefined()
    expect(findVtjscTypeMetadata(didRecord as never, 'vna-mainnet-1', '144')).toBeUndefined()
  })
})
