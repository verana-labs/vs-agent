import { mapToEcosystem } from '@verana-labs/vs-agent-model'
import { describe, expect, it } from 'vitest'

describe('mapToEcosystem', () => {
  it('resolves the canonical vpr schema uri', () => {
    expect(mapToEcosystem('vpr:verana:vna-testnet-1:cs:16')).toBe(
      'https://idx.testnet.verana.network/verana/cs/v1/js/16',
    )
  })

  it('resolves the legacy vpr schema uri', () => {
    expect(mapToEcosystem('vpr:verana:vna-testnet-1/cs/v1/js/16')).toBe(
      'https://idx.testnet.verana.network/verana/cs/v1/js/16',
    )
  })

  it('passes through non-vpr inputs', () => {
    expect(mapToEcosystem('https://example.io/schema.json')).toBe('https://example.io/schema.json')
  })
})
