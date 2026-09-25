import { VtFlowRole, VtFlowService, VtFlowState, VtFlowVariant } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

// the withdrawal republishes the self-issued default, which would otherwise sign and fetch
const { publishSelfIssuedEcsPresentation } = vi.hoisted(() => ({
  publishSelfIssuedEcsPresentation: vi.fn(),
}))
vi.mock('../src/utils/selfIssuedEcsCredential', () => ({ publishSelfIssuedEcsPresentation }))

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
  completeVtFlowRecordsWithoutCredential,
  markVtFlowRecordsValidated,
  reconcileVtFlowRecordsOnCancel,
  removeHolderTrustCredentialIfRevoked,
  removeSelfIssuedEcsCredentialsIfIssuerRevoked,
  startParticipantOPAutoFlow,
} from '../src/blockchain/handlers/stateMutations'
import { IndexerActivity, VeranaSyncState } from '../src/blockchain/types'
import { vtFlowEvents } from '../src/events/VtFlowEvents'
import { VtFlowOrchestrator } from '../src/vtFlow'

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

  const CREDENTIAL_ID = 'did:web:agent#cred-1'
  const storedRecord = (id: string) => ({ id, getTags: () => ({ givenId: CREDENTIAL_ID }) })

  /**
   * A HOLDER whose only applicant exchange `cx-1` delivered the credential its linked VP publishes.
   * Format data is what credo returns for the exchange; the stored records are what its
   * attachment format left in each W3C store.
   */
  function revokedHolderAgent(exchange: {
    formatData: Record<string, unknown>
    v1Records?: ReturnType<typeof storedRecord>[]
    v2Records?: ReturnType<typeof storedRecord>[]
  }) {
    const vtc: Record<string, unknown> = {
      'https://validator/jsc.json': {
        credential: { id: CREDENTIAL_ID },
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
    const getFormatData = vi.fn().mockResolvedValue(exchange.formatData)
    const deleteV1ById = vi.fn()
    const deleteV2ById = vi.fn()
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const agent = {
      did: 'did:web:agent',
      publicApiBaseUrl: 'https://agent',
      indexer: {
        findParticipant: vi.fn().mockResolvedValue({ role: 6, did: 'did:web:agent', schemaId: 4 }),
      },
      context: {
        dependencyManager: {
          resolve: (token: unknown) => (token === VtFlowService ? { findAllByQuery } : { update: vi.fn() }),
        },
      },
      didcomm: { credentials: { getFormatData } },
      dids: { getCreatedDids: vi.fn().mockResolvedValue([didRecord]), update: vi.fn() },
      // a data model 2.0 credential received over RFC 0809 lives in a W3cV2CredentialRecord, a data
      // model 1.1 one in a W3cCredentialRecord
      w3cV2Credentials: {
        getAll: vi.fn().mockResolvedValue(exchange.v2Records ?? []),
        deleteById: deleteV2ById,
      },
      w3cCredentials: {
        getAll: vi.fn().mockResolvedValue(exchange.v1Records ?? []),
        deleteById: deleteV1ById,
      },
      config: { logger },
    }
    return {
      agent,
      metadataStore,
      didRecord,
      findAllByQuery,
      deleteV1ById,
      deleteV2ById,
      logger,
    }
  }

  it('removes the revoked HOLDER credential and its linked VP by credential id', async () => {
    const { agent, metadataStore, didRecord, findAllByQuery, deleteV2ById } = revokedHolderAgent({
      formatData: { credential: { dataIntegrity: { credential: { id: CREDENTIAL_ID } } } },
      v2Records: [storedRecord('w3c-v2-1')],
    })

    await removeHolderTrustCredentialIfRevoked(agent as never, '12')

    expect(agent.didcomm.credentials.getFormatData).toHaveBeenCalledWith('cx-1')
    expect(metadataStore['_vt/vtc']['https://validator/jsc.json']).toBeUndefined()
    expect(didRecord.didDocument.service).toEqual([])
    expect(deleteV2ById).toHaveBeenCalledWith('w3c-v2-1')

    // Non-HOLDER participants are left alone.
    agent.indexer.findParticipant.mockResolvedValue({ role: 1, did: 'did:web:agent', schemaId: 4 })
    findAllByQuery.mockClear()
    await removeHolderTrustCredentialIfRevoked(agent as never, '13')
    expect(findAllByQuery).not.toHaveBeenCalled()
  })

  it('warns and leaves the linked VP when the exchange carries no credential id', async () => {
    const { agent, metadataStore, didRecord, deleteV1ById, deleteV2ById, logger } = revokedHolderAgent({
      formatData: { credential: {} },
      v1Records: [storedRecord('w3c-1')],
    })

    await removeHolderTrustCredentialIfRevoked(agent as never, '12')

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cx-1'))
    expect(metadataStore['_vt/vtc']['https://validator/jsc.json']).toBeDefined()
    expect(didRecord.didDocument.service).toEqual([{ id: 'did:web:agent#vtc-1' }])
    expect(deleteV1ById).not.toHaveBeenCalled()
    expect(deleteV2ById).not.toHaveBeenCalled()
  })

  it('withdraws the self-issued ECS credential of a revoked ISSUER participant', async () => {
    const serviceId = 'did:web:agent#vpr-schemas-service-vtc-vp'
    const vtc: Record<string, unknown> = {
      'https://ecosystem/vt/schemas-9-jsc.json': {
        credential: { id: 'did:web:agent' },
        verifiablePresentation: { id: 'https://agent/vt/ecs-service-vtc-vp.json' },
        didDocumentServiceId: serviceId,
        issuerParticipantId: 7,
        schemaKey: 'ecs-service',
      },
      'https://ecosystem/vt/schemas-3-jsc.json': { issuerParticipantId: 42, schemaKey: 'ecs-org' },
      selfA: { attached: true },
    }
    const metadataStore: Record<string, Record<string, unknown>> = { '_vt/vtc': vtc, '_vt/jsc': {} }
    const didRecord = {
      did: 'did:web:agent',
      didDocument: { id: 'did:web:agent', service: [{ id: serviceId }] },
      metadata: {
        get: (k: string) => metadataStore[k],
        set: (k: string, v: Record<string, unknown>) => {
          metadataStore[k] = v
        },
      },
    }
    const agent = {
      did: 'did:web:agent',
      publicApiBaseUrl: 'https://agent',
      indexer: {
        findParticipant: vi.fn().mockResolvedValue({ id: 7, role: 1, did: 'did:web:agent', schemaId: 9 }),
      },
      context: { dependencyManager: { resolve: () => ({ update: vi.fn() }) } },
      dids: { getCreatedDids: vi.fn().mockResolvedValue([didRecord]), update: vi.fn() },
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    }

    await removeSelfIssuedEcsCredentialsIfIssuerRevoked(agent as never, '7')

    expect(metadataStore['_vt/vtc']['https://ecosystem/vt/schemas-9-jsc.json']).toBeUndefined()
    expect(didRecord.didDocument.service).toEqual([])
    // the credential of another participant survives, and nothing is republished
    expect(metadataStore['_vt/vtc']['https://ecosystem/vt/schemas-3-jsc.json']).toBeDefined()
    expect(publishSelfIssuedEcsPresentation).not.toHaveBeenCalled()

    // A HOLDER participant is not this handler's business.
    agent.indexer.findParticipant.mockResolvedValue({ id: 8, role: 6, did: 'did:web:agent' })
    await removeSelfIssuedEcsCredentialsIfIssuerRevoked(agent as never, '8')
    expect(metadataStore['_vt/vtc']['https://ecosystem/vt/schemas-3-jsc.json']).toBeDefined()
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

describe('startParticipantOPAutoFlow', () => {
  it('sends the onboarding request of a non-ECS schema without claims, as a normal case', async () => {
    const startOnboardingProcess = vi
      .spyOn(VtFlowOrchestrator.prototype, 'startOnboardingProcess')
      .mockResolvedValue({} as never)
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const agent = {
      did: 'did:web:agent',
      veranaChain: {},
      ecsClaims: { org: { name: 'Acme' } },
      config: { logger },
      indexer: {
        findParticipant: vi.fn().mockResolvedValue({ id: 5, did: 'did:web:agent', schemaId: 12 }),
        getCredentialSchema: vi
          .fn()
          .mockResolvedValue({ id: 12, json_schema: '{"title":"ExampleCredential"}' }),
      },
    }

    await startParticipantOPAutoFlow(agent as never, makeActivity('StartParticipantOP', { entity_id: '5' }))

    expect(startOnboardingProcess).toHaveBeenCalledWith({ applicantParticipantId: 5 })
    expect(logger.warn).not.toHaveBeenCalled()
    startOnboardingProcess.mockRestore()
  })
})

describe('markVtFlowRecordsValidated', () => {
  const tx = { hash: 'TXHASH', height: 100, timestamp: '2026-09-25T10:00:00Z' }
  const entry = {
    validation_fees: 3,
    issuance_fees: 4,
    verification_fees: 5,
    issuance_fee_discount: 0.25,
    verification_fee_discount: 0.5,
    effective_until: '2027-09-25T10:00:00Z',
  }

  function makeValidatedAgent(records: Record<string, unknown>[]) {
    const recordValidation = vi.fn().mockResolvedValue(undefined)
    const continueAfterValidated = vi
      .spyOn(VtFlowOrchestrator.prototype, 'continueAfterValidated')
      .mockResolvedValue({} as never)
    const agent = {
      indexer: { getParticipant: vi.fn().mockResolvedValue(entry) },
      context: {
        dependencyManager: {
          resolve: () => ({ findAllByQuery: vi.fn().mockResolvedValue(records), recordValidation }),
        },
      },
      config: { logger: { info: vi.fn(), error: vi.fn() } },
    }
    return { agent, recordValidation, continueAfterValidated }
  }

  it('moves only the running validator flows of the participant, and continues into issuance', async () => {
    const records = [
      { id: 'applicant', role: VtFlowRole.Applicant, state: VtFlowState.Validating },
      { id: 'validator', role: VtFlowRole.Validator, state: VtFlowState.Validating },
      { id: 'terminated', role: VtFlowRole.Validator, state: VtFlowState.TerminatedByValidator },
    ]
    const { agent, recordValidation, continueAfterValidated } = makeValidatedAgent(records)

    await markVtFlowRecordsValidated(agent as never, '7', tx)

    expect(recordValidation).toHaveBeenCalledTimes(1)
    expect(recordValidation).toHaveBeenCalledWith(
      expect.anything(),
      'validator',
      expect.anything(),
      VtFlowState.Validated,
    )
    expect(continueAfterValidated).toHaveBeenCalledWith('validator')
    continueAfterValidated.mockRestore()
  })

  it('tells its own transaction apart from an operator one and takes the terms from the entry', async () => {
    const decidedAt = '2026-09-25T09:00:00Z'
    const records = [
      {
        id: 'agent',
        role: VtFlowRole.Validator,
        state: VtFlowState.ValidationTxFailed,
        validation: {
          decidedAt,
          submission: 'AGENT',
          validationFees: 9,
          tx: { hash: 'TXHASH', status: 'FAILED', reason: 'TX_NOT_FOUND', error: 'not found' },
        },
      },
      { id: 'operator', role: VtFlowRole.Validator, state: VtFlowState.OobPending },
    ]
    const { agent, recordValidation, continueAfterValidated } = makeValidatedAgent(records)

    await markVtFlowRecordsValidated(agent as never, '7', tx)

    const terms = {
      validationFees: 3,
      issuanceFees: 4,
      verificationFees: 5,
      issuanceFeeDiscount: 0.25,
      verificationFeeDiscount: 0.5,
      effectiveUntil: '2027-09-25T10:00:00Z',
    }
    expect(recordValidation).toHaveBeenCalledWith(
      expect.anything(),
      'agent',
      {
        decidedAt,
        submission: 'AGENT',
        ...terms,
        tx: { hash: 'TXHASH', height: 100, status: 'SUCCEEDED' },
      },
      VtFlowState.Validated,
    )
    expect(recordValidation).toHaveBeenCalledWith(
      expect.anything(),
      'operator',
      { decidedAt: tx.timestamp, submission: 'OPERATOR', ...terms },
      VtFlowState.Validated,
    )
    continueAfterValidated.mockRestore()
  })

  it('moves a flow rejected while its transaction was in flight to VALIDATED, and issues nothing yet', async () => {
    const records = [
      {
        id: 'rejected',
        role: VtFlowRole.Validator,
        state: VtFlowState.TerminatedByValidator,
        validation: { decidedAt: '2026-09-25T09:00:00Z', submission: 'OPERATOR' },
      },
    ]
    const { agent, recordValidation, continueAfterValidated } = makeValidatedAgent(records)

    await markVtFlowRecordsValidated(agent as never, '7', tx)

    expect(recordValidation).toHaveBeenCalledWith(
      expect.anything(),
      'rejected',
      expect.objectContaining({ submission: 'OPERATOR' }),
      VtFlowState.Validated,
    )
    expect(continueAfterValidated).not.toHaveBeenCalled()
    continueAfterValidated.mockRestore()
  })
})

describe('completeVtFlowRecordsWithoutCredential', () => {
  it('leaves the applicant flow of a role other than HOLDER in VALIDATED, its terminal state', async () => {
    const records = [
      { id: 'applicant', role: VtFlowRole.Applicant, state: VtFlowState.Validating },
      { id: 'validator', role: VtFlowRole.Validator, state: VtFlowState.Validated },
    ]
    const updateState = vi.fn().mockResolvedValue(undefined)
    const agent = {
      indexer: { findParticipant: vi.fn().mockResolvedValue({ role: 1 }) },
      context: {
        dependencyManager: {
          resolve: () => ({ findAllByQuery: vi.fn().mockResolvedValue(records), updateState }),
        },
      },
      config: { logger: { info: vi.fn(), error: vi.fn() } },
    }

    await completeVtFlowRecordsWithoutCredential(agent as never, '7')

    expect(updateState).toHaveBeenCalledTimes(1)
    expect(updateState).toHaveBeenCalledWith(expect.anything(), records[0], VtFlowState.Validated)
  })
})

describe('reconcileVtFlowRecordsOnCancel', () => {
  function makeCancelAgent(opState: number | undefined, records: Record<string, unknown>[]) {
    const updateState = vi.fn().mockResolvedValue(undefined)
    const agent = {
      indexer: {
        findParticipant:
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

describe('vtFlowEvents', () => {
  it('records the applicant entry on the next state change after the indexer failed', async () => {
    const record = {
      role: VtFlowRole.Validator,
      variant: VtFlowVariant.OnboardingProcess,
      state: VtFlowState.AwaitingOr,
      applicantParticipantId: '94',
    }
    const latest = { ...record, state: VtFlowState.Validating }
    const service = {
      findById: vi.fn().mockResolvedValue(record),
      getById: vi.fn().mockResolvedValue(latest),
      updateRecord: vi.fn().mockResolvedValue(undefined),
    }
    const on = vi.fn()
    const agent = {
      events: { on, emit: vi.fn() },
      context: { dependencyManager: { resolve: () => service } },
      indexer: {
        findParticipant: vi
          .fn()
          .mockRejectedValueOnce(new Error('indexer down'))
          .mockResolvedValue({ role: 6, validatorParticipantId: 93, schemaId: 12 }),
      },
    }
    vtFlowEvents(agent as never, { debug: vi.fn(), warn: vi.fn() } as never)
    const [, listener] = on.mock.calls[0]

    await listener({
      payload: { vtFlowRecordId: 'rec-v', state: VtFlowState.AwaitingOr, previousState: null },
    })
    expect(service.updateRecord).not.toHaveBeenCalled()

    await listener({
      payload: {
        vtFlowRecordId: 'rec-v',
        state: VtFlowState.Validating,
        previousState: VtFlowState.AwaitingOr,
      },
    })

    expect(agent.indexer.findParticipant).toHaveBeenCalledWith('94')
    expect(service.updateRecord).toHaveBeenCalledWith(agent.context, {
      ...latest,
      validatorParticipantId: '93',
      applicantParticipantRole: 6,
      schemaId: '12',
    })
  })
})
