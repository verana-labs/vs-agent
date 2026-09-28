import { describe, expect, it, vi } from 'vitest'

import { findVtjscTypeMetadata, saveVtjscTypeMetadata } from '../src/utils/trustCredentialStore'

const schemaRef = (id: number) => `vpr:verana:vna-testnet-1:cs:${id}`
const bytes = (id: number) => `{"vct":"https://agent.example/vt/vct/${id}"}`

/** A DID record whose `_vt/jsc` bucket holds the given entries, as the agent stores them. */
function didRecordWith(entries: Record<string, Record<string, unknown>>) {
  return { metadata: { get: () => entries, set: vi.fn() } }
}

describe('saveVtjscTypeMetadata', () => {
  it('stores the document once and keeps the first bytes, which issuers hashed', async () => {
    const entries: Record<string, Record<string, unknown>> = {
      [schemaRef(144)]: { didDocumentServiceId: '#s' },
    }
    const agent = {
      context: { dependencyManager: { resolve: () => ({ update: vi.fn() }) } },
      dids: { getCreatedDids: async () => [didRecordWith(entries)] },
    }

    await expect(saveVtjscTypeMetadata(agent as never, schemaRef(144), bytes(144))).resolves.toBe(true)
    await expect(saveVtjscTypeMetadata(agent as never, schemaRef(144), '{"vct":"other"}')).resolves.toBe(
      false,
    )

    expect(entries[schemaRef(144)].typeMetadata).toBe(bytes(144))
  })
})

describe('findVtjscTypeMetadata', () => {
  const didRecord = didRecordWith({
    [schemaRef(144)]: { typeMetadata: bytes(144) },
    [schemaRef(1440)]: { typeMetadata: bytes(1440) },
  })

  it('answers the whole on-chain schema id and nothing shorter or unknown', () => {
    expect(findVtjscTypeMetadata(didRecord as never, '144')).toBe(bytes(144))
    expect(findVtjscTypeMetadata(didRecord as never, '14')).toBeUndefined()
    expect(findVtjscTypeMetadata(didRecord as never, '7')).toBeUndefined()
  })
})
