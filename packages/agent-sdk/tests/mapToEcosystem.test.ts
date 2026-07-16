import { mapToEcosystem } from '@verana-labs/vs-agent-model'
import { describe, expect, it } from 'vitest'

describe('mapToEcosystem', () => {
  it('resolves the canonical vpr schema uri', () => {
    expect(mapToEcosystem('vpr:verana:vna-testnet-1:cs:16')).toBe(
      'https://idx.testnet.verana.network/verana/cs/v1/js/16',
    )
  })
})
