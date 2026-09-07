import type { VsAgent } from '../src/agent/VsAgent'
import type { VeranaIndexerService } from '../src/blockchain'

import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { ParticipantRole, ParticipantState } from '../src/blockchain'
import { EcsBootstrapService, type EcsBootstrapOptions } from '../src/bootstrap/EcsBootstrapService'
import { HOLDER_PARTICIPANT_TYPE } from '../src/types'

const startOnboardingProcess = vi.fn().mockResolvedValue({ id: 'flow-1', state: 'OR_SENT' })
vi.mock('../src/vtFlow/VtFlowOrchestrator', () => ({
  VtFlowOrchestrator: class {
    startOnboardingProcess = startOnboardingProcess
  },
}))
vi.mock('../src/utils/didReadiness', () => ({
  waitUntilOwnDidIsPubliclyResolvable: vi.fn().mockResolvedValue(undefined),
}))

const START_OP = '/verana.pp.v1.MsgStartParticipantOP'
const SELF_CREATE = '/verana.pp.v1.MsgSelfCreateParticipant'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const orgSchema = {
  id: 4,
  ecosystem_id: 1,
  json_schema: JSON.stringify({ title: 'OrganizationCredential', type: 'object' }),
  archived: null,
  created: '',
  modified: '',
}
const serviceSchema = {
  id: 5,
  ecosystem_id: 1,
  json_schema: JSON.stringify({ title: 'ServiceCredential', type: 'object' }),
  archived: null,
  created: '',
  modified: '',
}

function makeMocks() {
  const eventHandlers: ((event: { payload: Record<string, unknown> }) => Promise<void> | void)[] = []
  const chain = {
    address: 'verana1agent',
    listOperatorAuthorizations: vi.fn().mockResolvedValue([{ msgTypes: [START_OP] }]),
    getBalance: vi.fn().mockResolvedValue({ denom: 'uvna', amount: '1000000' }),
    getCredentialSchema: vi.fn().mockResolvedValue({
      id: 5,
      ecosystemId: 1,
      jsonSchema: serviceSchema.json_schema,
      issuerOnboardingMode: 2,
    }),
    startParticipantOP: vi.fn().mockResolvedValue({ participantId: 77, txHash: 'AA' }),
    selfCreateParticipant: vi.fn().mockResolvedValue({ participantId: 88, txHash: 'BB' }),
    setParticipantOPToValidated: vi.fn().mockResolvedValue(undefined),
    triggerResolver: vi.fn().mockResolvedValue(undefined),
  }
  const indexer = {
    listEcosystems: vi.fn().mockResolvedValue([{ id: 1, did: 'did:example:eco', archived: null }]),
    getEcosystem: vi.fn().mockResolvedValue({ id: 1, did: 'did:example:eco', archived: null }),
    getCredentialSchema: vi.fn().mockResolvedValue(serviceSchema),
    getParticipant: vi.fn().mockResolvedValue({ id: 3, did: 'did:web:parent' }),
    listCredentialSchemas: vi.fn().mockResolvedValue([orgSchema, serviceSchema]),
    listParticipants: vi.fn().mockResolvedValue([]),
  }
  const vtFlowApi = {
    findAllByQuery: vi.fn().mockResolvedValue([]),
    sendIssuanceRequest: vi.fn().mockResolvedValue({ id: 'rec-1' }),
  }
  const agent = {
    did: 'did:web:agent',
    label: 'Agent',
    publicApiBaseUrl: 'https://agent',
    veranaChain: chain,
    config: { logger },
    events: {
      on: (_type: string, cb: (event: { payload: Record<string, unknown> }) => void) => {
        eventHandlers.push(cb)
      },
      off: (_type: string, cb: (event: { payload: Record<string, unknown> }) => void) => {
        const index = eventHandlers.indexOf(cb)
        if (index !== -1) eventHandlers.splice(index, 1)
      },
    },
    dependencyManager: { resolve: () => vtFlowApi },
    context: { resolve: () => ({ update: vi.fn().mockResolvedValue(undefined) }) },
    didcomm: {
      oob: {
        receiveImplicitInvitation: vi
          .fn()
          .mockResolvedValue({ connectionRecord: { id: 'conn-1', setTag: vi.fn() } }),
      },
      connections: {
        findAllByQuery: vi.fn().mockResolvedValue([]),
        returnWhenIsConnected: vi.fn().mockResolvedValue({ id: 'conn-1' }),
        deleteById: vi.fn().mockResolvedValue(undefined),
      },
      credentials: { acceptOffer: vi.fn().mockResolvedValue(undefined) },
    },
  }
  return { agent, chain, indexer, vtFlowApi, eventHandlers }
}

function makeService(
  mocks: ReturnType<typeof makeMocks>,
  options: Partial<EcsBootstrapOptions> = {},
): EcsBootstrapService {
  return new EcsBootstrapService(
    mocks.agent as unknown as VsAgent,
    mocks.indexer as unknown as VeranaIndexerService,
    { mode: 'standalone', trustedEcosystemDids: ['did:example:eco'], ...options },
    logger as never,
  )
}

describe('EcsBootstrapService standalone', () => {
  it.each([
    ['TRUSTED_ECS_ECOSYSTEM_DIDS is not set', {}, { trustedEcosystemDids: undefined }],
    ['no OperatorAuthorization', { oas: [] }, {}],
    ['no balance', { balance: '0' }, {}],
  ])('skips without starting anything when %s', async (_name, mockTweaks, optionTweaks) => {
    const mocks = makeMocks()
    if ('oas' in mockTweaks) mocks.chain.listOperatorAuthorizations.mockResolvedValue([])
    if ('balance' in mockTweaks) mocks.chain.getBalance.mockResolvedValue({ denom: 'uvna', amount: '0' })

    await makeService(mocks, optionTweaks).run()

    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('skipped'))
  })

  it('starts the HOLDER onboarding and the Service ISSUER onboarding', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockImplementation(
      async (filter: { role?: string; schemaId?: number; did?: string }) => {
        if (filter.did === 'did:web:agent') return []
        if (filter.role === ParticipantRole.Issuer && filter.schemaId === 4) {
          return [{ id: 2, did: 'did:web:validator', participant_state: ParticipantState.Active }]
        }
        if (filter.role === ParticipantRole.Ecosystem && filter.schemaId === 5) {
          return [{ id: 1, did: 'did:example:eco', participant_state: ParticipantState.Active }]
        }
        return []
      },
    )

    await makeService(mocks, {
      trustedEcosystemDids: ['did:example:unknown', 'did:example:eco'],
    }).run()

    expect(mocks.chain.startParticipantOP).toHaveBeenCalledTimes(2)
    const [holderCall, issuerCall] = mocks.chain.startParticipantOP.mock.calls
    expect(holderCall[0]).toMatchObject({ role: 6, validatorParticipantId: 2, did: 'did:web:agent' })
    expect(issuerCall[0]).toMatchObject({ role: 1, validatorParticipantId: 1 })
  })

  it('fails when no trusted ecosystem DID resolves to a usable ecosystem', async () => {
    const mocks = makeMocks()
    mocks.indexer.listEcosystems.mockResolvedValue([])

    await expect(makeService(mocks).run()).rejects.toThrow('no trusted ECS ecosystem is usable')
    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
  })

  it('excludes expired participants from reuse', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockImplementation(
      async (filter: { role?: string; schemaId?: number; did?: string }) => {
        if (filter.did === 'did:web:agent') {
          return [
            {
              id: 9,
              participant_state: 'EXPIRED',
              op_state: 'VALIDATED',
              revoked: null,
              slashed: null,
            },
          ]
        }
        if (filter.role === ParticipantRole.Issuer || filter.role === ParticipantRole.Ecosystem) {
          return [{ id: 2, did: 'did:web:validator', participant_state: ParticipantState.Active }]
        }
        return []
      },
    )

    await makeService(mocks).run()

    expect(mocks.chain.startParticipantOP).toHaveBeenCalledTimes(2)
  })

  it('self-creates the Service ISSUER when the schema mode is OPEN', async () => {
    const mocks = makeMocks()
    mocks.chain.listOperatorAuthorizations.mockResolvedValue([{ msgTypes: [START_OP, SELF_CREATE] }])
    mocks.chain.getCredentialSchema.mockResolvedValue({
      id: 5,
      ecosystemId: 1,
      jsonSchema: serviceSchema.json_schema,
      issuerOnboardingMode: 1,
    })
    mocks.indexer.listParticipants.mockImplementation(
      async (filter: { role?: string; schemaId?: number; did?: string }) => {
        if (filter.did === 'did:web:agent') {
          return filter.role === ParticipantRole.Holder
            ? [{ id: 9, participant_state: ParticipantState.Active, revoked: null, slashed: null }]
            : []
        }
        if (filter.role === ParticipantRole.Ecosystem) {
          return [
            { id: 1, participant_state: ParticipantState.Active, effective_until: '2030-01-01T00:00:00Z' },
          ]
        }
        return []
      },
    )

    await makeService(mocks).run()

    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
    expect(mocks.chain.selfCreateParticipant).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 1,
        validatorParticipantId: 1,
        effectiveUntil: new Date('2030-01-01T00:00:00Z'),
      }),
    )
  })

  it('fails OPEN self-creation when the operator lacks the MsgSelfCreateParticipant authorization', async () => {
    const mocks = makeMocks()
    mocks.chain.getCredentialSchema.mockResolvedValue({
      id: 5,
      ecosystemId: 1,
      jsonSchema: serviceSchema.json_schema,
      issuerOnboardingMode: 1,
    })
    mocks.indexer.listParticipants.mockImplementation(async (filter: { role?: string; did?: string }) => {
      if (filter.did === 'did:web:agent') {
        return filter.role === ParticipantRole.Holder
          ? [{ id: 9, participant_state: ParticipantState.Active, revoked: null, slashed: null }]
          : []
      }
      return []
    })

    await expect(makeService(mocks).run()).rejects.toThrow('MsgSelfCreateParticipant')
    expect(mocks.chain.selfCreateParticipant).not.toHaveBeenCalled()
  })

  it('re-accepts applicant flows left at CRED_OFFERED across a restart', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockImplementation(async (filter: { role?: string; did?: string }) => {
      if (filter.did === 'did:web:agent') {
        return [{ id: 9, participant_state: ParticipantState.Active, revoked: null, slashed: null }]
      }
      return []
    })
    mocks.vtFlowApi.findAllByQuery.mockResolvedValue([
      { id: 'flow-1', credentialExchangeRecordId: 'cred-ex-1' },
      { id: 'flow-2', credentialExchangeRecordId: undefined },
    ])

    await makeService(mocks).run()

    expect(mocks.vtFlowApi.findAllByQuery).toHaveBeenCalledWith({
      flowState: VtFlowState.CredOffered,
      role: VtFlowRole.Applicant,
    })
    expect(mocks.agent.didcomm.credentials.acceptOffer).toHaveBeenCalledTimes(1)
    expect(mocks.agent.didcomm.credentials.acceptOffer).toHaveBeenCalledWith({
      credentialExchangeRecordId: 'cred-ex-1',
    })
  })
})

describe('EcsBootstrapService onboarding resume', () => {
  // The chain event handler swallows its own failure and the indexer never replays that block,
  // so an entry left at PENDING is the only trace of an onboarding request that never went out.
  const pendingHolder = {
    id: 42,
    schema_id: 5,
    op_state: 'PENDING',
    validator_participant_id: 3,
    revoked: null,
    slashed: null,
  }

  function onlyOwnPending(mocks: ReturnType<typeof makeMocks>) {
    mocks.indexer.listParticipants.mockImplementation(async (query: Record<string, unknown>) => {
      if (query.did === 'did:web:agent') return [pendingHolder]
      // The parent Service ISSUER, so that the delegated bootstrap reaches its own reuse branch.
      return query.did === 'did:web:parent' ? [{ id: 3, schema_id: 5 }] : []
    })
  }

  it.each([['standalone'], ['delegated']] as const)('resumes a PENDING onboarding in %s mode', async mode => {
    const mocks = makeMocks()
    onlyOwnPending(mocks)

    await makeService(mocks, {
      mode,
      delegatedParentVsDid: 'did:web:parent',
      verifyPeer: async () => true,
    }).run()

    expect(startOnboardingProcess).toHaveBeenCalledWith({ applicantParticipantId: 42 })
  })

  it('resumes even when the operator can no longer start an OP', async () => {
    const mocks = makeMocks()
    onlyOwnPending(mocks)
    mocks.chain.listOperatorAuthorizations.mockResolvedValue([])

    await makeService(mocks).run()

    // The request signs nothing on chain, so the gate that stops a new OP must not stop the repair.
    expect(startOnboardingProcess).toHaveBeenCalledWith({ applicantParticipantId: 42 })
    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
  })

  it.each([
    [VtFlowState.Error, true],
    [VtFlowState.TerminatedByValidator, false],
  ])('resends after %s: %s', async (state, resends) => {
    const mocks = makeMocks()
    onlyOwnPending(mocks)
    mocks.vtFlowApi.findAllByQuery.mockImplementation(async (query: Record<string, unknown>) =>
      query.participantId === '42' ? [{ id: 'flow-1', state, createdAt: new Date() }] : [],
    )

    await makeService(mocks).run()

    expect(startOnboardingProcess).toHaveBeenCalledTimes(resends ? 1 : 0)
  })

  it('validates a self-issued participant instead of sending a request', async () => {
    const mocks = makeMocks()
    onlyOwnPending(mocks)
    // The validator of the entry is this agent, so no peer can answer an onboarding request.
    mocks.indexer.getParticipant.mockResolvedValue({ id: 3, did: 'did:web:agent' })

    await makeService(mocks).run()

    expect(startOnboardingProcess).not.toHaveBeenCalled()
    expect(mocks.chain.setParticipantOPToValidated).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }))
  })

  it('carries on with the bootstrap when the resume fails', async () => {
    const mocks = makeMocks()
    onlyOwnPending(mocks)
    startOnboardingProcess.mockRejectedValueOnce(new Error('parent unreachable'))

    await expect(makeService(mocks).run()).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('parent unreachable'))
  })
})

describe('EcsBootstrapService delegated', () => {
  const delegated = { mode: 'delegated' as const, delegatedParentVsDid: 'did:web:parent' }

  // The parent's Service ISSUER entry; the child onboards as a HOLDER against it.
  const parentIssuer = { id: 3, schema_id: 5 }

  function onlyParentIssuer(mocks: ReturnType<typeof makeMocks>) {
    // The parent holds the ISSUER entry; the child holds no HOLDER entry yet.
    mocks.indexer.listParticipants.mockImplementation(async (query: Record<string, unknown>) =>
      query.did === 'did:web:parent' ? [parentIssuer] : [],
    )
  }

  function withOwnHolder(mocks: ReturnType<typeof makeMocks>, holder: Record<string, unknown>) {
    mocks.indexer.listParticipants.mockImplementation(async (query: Record<string, unknown>) =>
      query.did === 'did:web:parent' ? [parentIssuer] : [holder],
    )
  }

  it('fails when peer verification is not configured', async () => {
    const mocks = makeMocks()
    const service = makeService(mocks, delegated)
    await expect(service.run()).rejects.toThrow('verifiable public registries are not configured')
  })

  it('fails when the parent is not a Verifiable Service', async () => {
    const mocks = makeMocks()
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => false })
    await expect(service.run()).rejects.toThrow('did:web:parent is not a Verifiable Service')
  })

  it('fails when the parent holds no Service ISSUER participant', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockResolvedValue([])
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })
    await expect(service.run()).rejects.toThrow('no active ISSUER participant for an ECS Service schema')
  })

  it('starts a HOLDER onboarding process against the parent Service ISSUER', async () => {
    const mocks = makeMocks()
    onlyParentIssuer(mocks)
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    await expect(service.run()).resolves.toBeUndefined()

    // [VSA-VTI-FLOW-OP-NEW] step 1. Direct Issuance needs holder_onboarding_mode = PERMISSIONLESS,
    // which the ECS Service schema does not use, so no issuance request is sent.
    expect(mocks.chain.startParticipantOP).toHaveBeenCalledWith({
      role: HOLDER_PARTICIPANT_TYPE,
      validatorParticipantId: 3,
      did: 'did:web:agent',
    })
    expect(mocks.vtFlowApi.sendIssuanceRequest).not.toHaveBeenCalled()
  })

  it('skips the parent ISSUER entries that are revoked or slashed', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockImplementation(async (query: Record<string, unknown>) =>
      query.did === 'did:web:parent' ? [{ ...parentIssuer, revoked: '2026-01-01' }] : [],
    )
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    await expect(service.run()).rejects.toThrow('no active ISSUER participant for an ECS Service schema')
  })

  it('fails when TRUSTED_ECS_ECOSYSTEM_DIDS does not list the ecosystem of the schema', async () => {
    const mocks = makeMocks()
    onlyParentIssuer(mocks)
    const service = makeService(mocks, {
      ...delegated,
      trustedEcosystemDids: ['did:example:other'],
      verifyPeer: async () => true,
    })

    await expect(service.run()).rejects.toThrow('TRUSTED_ECS_ECOSYSTEM_DIDS does not list')
    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
  })

  it('starts the onboarding when no allowlist is configured', async () => {
    const mocks = makeMocks()
    onlyParentIssuer(mocks)
    const service = makeService(mocks, {
      ...delegated,
      trustedEcosystemDids: undefined,
      verifyPeer: async () => true,
    })

    await expect(service.run()).resolves.toBeUndefined()
    expect(mocks.indexer.getEcosystem).not.toHaveBeenCalled()
    expect(mocks.chain.startParticipantOP).toHaveBeenCalled()
  })

  it('does not start a second onboarding when a HOLDER participant already exists', async () => {
    const mocks = makeMocks()
    withOwnHolder(mocks, {
      id: 42,
      schema_id: 5,
      validator_participant_id: 3,
      participant_state: ParticipantState.Active,
    })
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    await expect(service.run()).resolves.toBeUndefined()
    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
  })

  it('fails when an existing HOLDER participant names another validator', async () => {
    const mocks = makeMocks()
    withOwnHolder(mocks, {
      id: 42,
      schema_id: 5,
      validator_participant_id: 9,
      participant_state: ParticipantState.Active,
    })
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    await expect(service.run()).rejects.toThrow('not the parent VS did:web:parent')
    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
  })

  it('restarts the onboarding when the only HOLDER participant is terminated', async () => {
    const mocks = makeMocks()
    withOwnHolder(mocks, { id: 42, schema_id: 5, validator_participant_id: 3, op_state: 'TERMINATED' })
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    await expect(service.run()).resolves.toBeUndefined()
    expect(mocks.chain.startParticipantOP).toHaveBeenCalled()
  })

  it.each([
    [
      'the operator cannot start an OP',
      (m: ReturnType<typeof makeMocks>) => m.chain.listOperatorAuthorizations.mockResolvedValue([]),
    ],
    [
      'the operator has no balance',
      (m: ReturnType<typeof makeMocks>) =>
        m.chain.getBalance.mockResolvedValue({ denom: 'uvna', amount: '0' }),
    ],
  ])('waits for out-of-band provisioning when %s', async (_name, tweak) => {
    const mocks = makeMocks()
    onlyParentIssuer(mocks)
    tweak(mocks)
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    await expect(service.run()).resolves.toBeUndefined()
    expect(mocks.chain.startParticipantOP).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('delegated bootstrap skipped'))
  })
})
