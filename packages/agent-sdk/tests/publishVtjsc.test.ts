import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishVtjscIfOwner } from '../src/blockchain/handlers/stateMutations'
import { VeranaSyncState } from '../src/blockchain/types'

const createJsc = vi.fn()
vi.mock('../src/utils/trustCredentialStore', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils/trustCredentialStore')>()),
  createJsc: (...args: unknown[]) => createJsc(...args),
}))

function makeAgent() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }
  return {
    agent: {
      config: { logger },
      publicApiBaseUrl: 'https://agent.example',
      veranaChain: { getChainId: 'vna-demo-1' },
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
