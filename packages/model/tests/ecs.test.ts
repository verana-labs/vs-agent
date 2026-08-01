import { describe, expect, it } from 'vitest'

import { mapToEcosystem } from '../src/utils/ecs'

describe('mapToEcosystem', () => {
  it('maps a canonical testnet schema id to the v3 indexer js path', () => {
    expect(mapToEcosystem('vpr:verana:vna-testnet-1:cs:170')).toBe(
      'https://idx.testnet.verana.network/verana/cs/v1/js/170',
    )
  })

  it('maps an expanded testnet schema ref to the v3 indexer', () => {
    expect(mapToEcosystem('vpr:verana:vna-testnet-1/cs/v1/js/170')).toBe(
      'https://idx.testnet.verana.network/verana/cs/v1/js/170',
    )
  })

  it('maps a canonical devnet schema id to the v4 credential-schema js path', () => {
    expect(mapToEcosystem('vpr:verana:vna-devnet-1:cs:5')).toBe(
      'https://idx.devnet.verana.network/v4/credential-schema/js/5',
    )
  })

  it('maps an expanded devnet schema ref to the v4 credential-schema js path', () => {
    expect(mapToEcosystem('vpr:verana:vna-devnet-1/cs/v1/js/5')).toBe(
      'https://idx.devnet.verana.network/v4/credential-schema/js/5',
    )
  })

  it('maps other devnet paths onto the v4 base', () => {
    expect(mapToEcosystem('vpr:verana:vna-devnet-1/participant/list')).toBe(
      'https://idx.devnet.verana.network/v4/participant/list',
    )
  })

  it('returns unknown networks unchanged', () => {
    expect(mapToEcosystem('vpr:verana:vna-unknown-1:cs:1')).toBe('vpr:verana:vna-unknown-1/cs/v1/js/1')
  })

  it('returns non-vpr URLs unchanged', () => {
    expect(mapToEcosystem('https://example.com/schemas/service.json')).toBe(
      'https://example.com/schemas/service.json',
    )
  })
})
