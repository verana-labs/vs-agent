import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IndexerHandlerRegistry } from '../src/blockchain/handlers/IndexerHandlerRegistry'
import { registerSelfIssuanceAnchorHandlers } from '../src/blockchain/handlers/selfIssuanceHandlers'
import { SelfTrDefaults } from '../src/utils/setupSelfTr'

const DID = 'did:web:agent.example'

const reconcileVtjscPublications = vi.fn()
vi.mock('../src/blockchain/handlers/stateMutations', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/blockchain/handlers/stateMutations')>()),
  reconcileVtjscPublications: (...args: unknown[]) => reconcileVtjscPublications(...args),
}))

const defaults = {} as SelfTrDefaults

function makeContext() {
  return {
    agent: {
      did: DID,
      veranaChain: { address: 'verana1operator' },
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    },
    blockHeight: 1,
    operatorAddress: 'verana1operator',
    state: {},
    txHash: 'ABC',
  } as never
}

function makeIndexer(participant: unknown) {
  return { getParticipant: vi.fn(async () => participant) } as never
}

async function dispatch(msg: string, participant: unknown) {
  const registry = new IndexerHandlerRegistry()
  const original = vi.fn()
  registry.register({ msg, handle: original })
  const indexer = makeIndexer(participant)
  registerSelfIssuanceAnchorHandlers(registry, indexer, 7, defaults)
  await registry.dispatch({ msg, entity_id: 42 } as never, makeContext())
  return { original, indexer }
}

describe('self-issuance anchor handlers', () => {
  beforeEach(() => {
    reconcileVtjscPublications.mockReset()
    reconcileVtjscPublications.mockResolvedValue(undefined)
  })

  it.each(['SetParticipantOPToValidated', 'SelfCreateParticipant'])(
    'reconciles the ECS credentials when %s makes the agent an ISSUER',
    async msg => {
      const { original } = await dispatch(msg, { id: 42, did: DID, role: 'ISSUER' })

      expect(original).toHaveBeenCalledTimes(1)
      expect(reconcileVtjscPublications).toHaveBeenCalledTimes(1)
      expect(reconcileVtjscPublications).toHaveBeenCalledWith(
        expect.objectContaining({ did: DID }),
        expect.anything(),
        7,
        defaults,
      )
    },
  )

  it('ignores a participant of another DID', async () => {
    await dispatch('SelfCreateParticipant', { id: 42, did: 'did:web:other.example', role: 'ISSUER' })

    expect(reconcileVtjscPublications).not.toHaveBeenCalled()
  })

  it('ignores a participant of the agent that is not an ISSUER', async () => {
    await dispatch('SetParticipantOPToValidated', { id: 42, did: DID, role: 'HOLDER' })

    expect(reconcileVtjscPublications).not.toHaveBeenCalled()
  })

  it('keeps dispatching when the reconciliation fails', async () => {
    reconcileVtjscPublications.mockRejectedValue(new Error('chain is unreachable'))

    await expect(dispatch('SelfCreateParticipant', { id: 42, did: DID, role: 'ISSUER' })).resolves.toEqual(
      expect.anything(),
    )
  })
})
