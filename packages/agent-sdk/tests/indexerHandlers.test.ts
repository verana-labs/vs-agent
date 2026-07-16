import { VtFlowRole, VtFlowService, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import {
  IndexerEventHandler,
  IndexerHandlerContext,
  IndexerHandlerRegistry,
} from '../src/blockchain/handlers/IndexerHandlerRegistry'
import {
  buildDefaultIndexerHandlerRegistry,
  defaultHandlers,
} from '../src/blockchain/handlers/defaultHandlers'
import {
  applyStateMutation,
  reconcileVtFlowRecordsOnCancel,
  removeHolderTrustCredentialIfRevoked,
} from '../src/blockchain/handlers/stateMutations'
import { IndexerActivity, VeranaSyncState } from '../src/blockchain/types'

function emptyState(): VeranaSyncState {
  return { lastBlockHeight: 0, ecosystems: {}, credentialSchemas: {}, participants: {} }
}

function makeContext(state: VeranaSyncState = emptyState()): IndexerHandlerContext {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }
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

  it('warns about per-DID subscriptions when a corporation rotates its DID', async () => {
    const registry = buildDefaultIndexerHandlerRegistry()
    const ctx = makeContext()
    await registry.dispatch(
      makeActivity('UpdateCorporation', { entity_type: 'Corporation', changes: { did: 'did:web:new' } }),
      ctx,
    )
    expect(ctx.agent.config.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('per-DID indexer subscriptions'),
    )
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

  it('marks an ecosystem archived on ArchiveEcosystem and clears it on unarchive', () => {
    const state = emptyState()
    applyStateMutation(
      state,
      makeActivity('ArchiveEcosystem', { entity_id: '3', changes: { archived: '2026-01-01T00:00:00Z' } }),
    )
    expect(state.ecosystems['3']).toMatchObject({ id: 3, archived: true })

    applyStateMutation(
      state,
      makeActivity('ArchiveEcosystem', { entity_id: '3', changes: { archived: null } }),
    )
    expect(state.ecosystems['3']).toMatchObject({ id: 3, archived: false })
  })

  it('removes the revoked HOLDER credential and its linked VP by credential id', async () => {
    const vtc: Record<string, unknown> = {
      'https://validator/jsc.json': {
        credential: { id: 'did:web:agent#cred-1' },
        verifiablePresentation: { id: 'https://agent/vp.json' },
        didDocumentServiceId: 'did:web:agent#vtc-1',
      },
      selfA: { attached: true },
      selfB: { attached: true },
      selfC: { attached: true },
    }
    const metadataStore: Record<string, Record<string, unknown>> = { '_vt/vtc': vtc }
    const didRecord = {
      did: 'did:web:agent',
      didDocument: { id: 'did:web:agent', service: [{ id: 'did:web:agent#vtc-1' }] },
      metadata: {
        get: (k: string) => metadataStore[k],
        set: (k: string, v: Record<string, unknown>) => {
          metadataStore[k] = v
        },
      },
    }
    const findAllByQuery = vi
      .fn()
      .mockResolvedValue([{ role: VtFlowRole.Applicant, credentialExchangeRecordId: 'cx-1' }])
    const getFormatData = vi
      .fn()
      .mockResolvedValue({ credential: { jsonld: { id: 'did:web:agent#cred-1' } } })
    const agent = {
      did: 'did:web:agent',
      publicApiBaseUrl: 'https://agent',
      veranaChain: {
        getParticipant: vi.fn().mockResolvedValue({ role: 6, did: 'did:web:agent', schemaId: 4 }),
      },
      context: {
        dependencyManager: {
          resolve: (token: unknown) => (token === VtFlowService ? { findAllByQuery } : { update: vi.fn() }),
        },
      },
      didcomm: { credentials: { getFormatData } },
      dids: { getCreatedDids: vi.fn().mockResolvedValue([didRecord]), update: vi.fn() },
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    }

    await removeHolderTrustCredentialIfRevoked(agent as never, '12')

    expect(getFormatData).toHaveBeenCalledWith('cx-1')
    expect(metadataStore['_vt/vtc']['https://validator/jsc.json']).toBeUndefined()
    expect(didRecord.didDocument.service).toEqual([])

    // Non-HOLDER participants are left alone.
    agent.veranaChain.getParticipant.mockResolvedValue({ role: 1, did: 'did:web:agent', schemaId: 4 })
    findAllByQuery.mockClear()
    await removeHolderTrustCredentialIfRevoked(agent as never, '13')
    expect(findAllByQuery).not.toHaveBeenCalled()
  })

  it('records the participant from SelfCreateParticipant and CreateRootParticipant', () => {
    const state = emptyState()
    applyStateMutation(
      state,
      makeActivity('SelfCreateParticipant', {
        entity_type: 'Participant',
        entity_id: '12',
        changes: { schema_id: 4, did: 'did:web:self', role: 1 },
      }),
    )
    applyStateMutation(
      state,
      makeActivity('CreateRootParticipant', {
        entity_type: 'Participant',
        entity_id: '13',
        changes: { schema_id: 4, did: 'did:web:root', role: 5 },
      }),
    )
    expect(state.participants['12']).toMatchObject({ id: 12, schemaId: 4, did: 'did:web:self' })
    expect(state.participants['13']).toMatchObject({ id: 13, schemaId: 4, did: 'did:web:root' })
  })
})

describe('reconcileVtFlowRecordsOnCancel', () => {
  function makeCancelAgent(opState: number | undefined, records: Record<string, unknown>[]) {
    const updateState = vi.fn().mockResolvedValue(undefined)
    const agent = {
      veranaChain: {
        getParticipant:
          opState === undefined
            ? vi.fn().mockRejectedValue(new Error('participant not found'))
            : vi.fn().mockResolvedValue({ opState }),
      },
      context: {
        dependencyManager: {
          resolve: () => ({ findAllByQuery: vi.fn().mockResolvedValue(records), updateState }),
        },
      },
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    }
    return { agent, updateState }
  }

  it('restores renewal-reset records to COMPLETED when the participant is still VALIDATED', async () => {
    for (const state of [
      VtFlowState.AwaitingOr,
      VtFlowState.OrSent,
      VtFlowState.OobPending,
      VtFlowState.Validating,
    ]) {
      const record = { state, credentialExchangeRecordId: 'cx-1' }
      const { agent, updateState } = makeCancelAgent(2, [record])

      await reconcileVtFlowRecordsOnCancel(agent as never, '7')

      expect(updateState).toHaveBeenCalledWith(expect.anything(), record, VtFlowState.Completed)
    }
  })

  it('leaves completed and terminal records untouched', async () => {
    const records = [
      { state: VtFlowState.Completed, credentialExchangeRecordId: 'cx-1' },
      { state: VtFlowState.TerminatedByApplicant, credentialExchangeRecordId: 'cx-1' },
    ]
    const { agent, updateState } = makeCancelAgent(2, records)

    await reconcileVtFlowRecordsOnCancel(agent as never, '7')

    expect(updateState).not.toHaveBeenCalled()
  })

  it('terminates records when the participant is no longer validated', async () => {
    for (const opState of [1, undefined]) {
      const record = { state: VtFlowState.AwaitingOr, credentialExchangeRecordId: 'cx-1' }
      const { agent, updateState } = makeCancelAgent(opState, [record])

      await reconcileVtFlowRecordsOnCancel(agent as never, '7')

      expect(updateState).toHaveBeenCalledWith(expect.anything(), record, VtFlowState.TerminatedByApplicant)
    }
  })

  it('terminates a validated participant record that has no prior credential exchange', async () => {
    const record = { state: VtFlowState.AwaitingOr }
    const { agent, updateState } = makeCancelAgent(2, [record])

    await reconcileVtFlowRecordsOnCancel(agent as never, '7')

    expect(updateState).toHaveBeenCalledWith(expect.anything(), record, VtFlowState.TerminatedByApplicant)
  })
})
