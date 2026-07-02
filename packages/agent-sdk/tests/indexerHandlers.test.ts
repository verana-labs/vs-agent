import { describe, expect, it, vi } from 'vitest'

import {
  IndexerEventHandler,
  IndexerHandlerContext,
  IndexerHandlerRegistry,
} from '../src/blockchain/handlers/IndexerHandlerRegistry'
import { buildDefaultIndexerHandlerRegistry, defaultHandlers } from '../src/blockchain/handlers/defaultHandlers'
import { applyStateMutation } from '../src/blockchain/handlers/stateMutations'
import { IndexerActivity, VeranaSyncState } from '../src/blockchain/types'

function emptyState(): VeranaSyncState {
  return { lastBlockHeight: 0, ecosystems: {}, credentialSchemas: {}, participants: {} }
}

function makeContext(state: VeranaSyncState = emptyState()): IndexerHandlerContext {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() }
  return {
    agent: { config: { logger } } as unknown as IndexerHandlerContext['agent'],
    blockHeight: 100,
    operatorAddress: 'verana1operator',
    state,
    txHash: 'TXHASH',
  }
}

function makeActivity(msg: string, overrides: Partial<IndexerActivity> = {}): IndexerActivity {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    block_height: 100,
    entity_type: 'Ecosystem',
    entity_id: '1',
    msg,
    changes: {},
    ...overrides,
  }
}

describe('IndexerHandlerRegistry', () => {
  it('dispatches an event to its registered handler', async () => {
    const registry = new IndexerHandlerRegistry()
    const handle = vi.fn().mockResolvedValue(undefined)
    registry.register({ msg: 'CustomEvent', handle } as IndexerEventHandler)

    const ctx = makeContext()
    const activity = makeActivity('CustomEvent')
    await registry.dispatch(activity, ctx)

    expect(handle).toHaveBeenCalledWith(activity, ctx)
  })

  it('lets a custom handler override the default for a msg', async () => {
    const registry = buildDefaultIndexerHandlerRegistry()
    const customHandle = vi.fn().mockResolvedValue(undefined)
    registry.register({ msg: 'CreateNewEcosystem', handle: customHandle })

    await registry.dispatch(makeActivity('CreateNewEcosystem'), makeContext())

    expect(customHandle).toHaveBeenCalledTimes(1)
  })

  it('registers a handler for every default msg', () => {
    const registry = buildDefaultIndexerHandlerRegistry()
    expect(registry.keys().sort()).toEqual(defaultHandlers.map(h => h.msg).sort())
  })
})

describe('applyStateMutation', () => {
  it('syncs state even when the handler registry is cleared', async () => {
    const registry = buildDefaultIndexerHandlerRegistry()
    registry.clear()

    const ctx = makeContext()
    const activity = makeActivity('RevokeParticipant', { entity_id: '9' })
    applyStateMutation(ctx.state, activity)
    await registry.dispatch(activity, ctx)

    expect(ctx.state.participants['9']).toMatchObject({ id: 9, revoked: true })
  })
})
