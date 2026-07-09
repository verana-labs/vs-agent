import type { VsAgent } from '../src/agent/VsAgent'
import type { VeranaIndexerService } from '../src/blockchain'

import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { ParticipantRole, ParticipantState } from '../src/blockchain'
import { EcsBootstrapService, type EcsBootstrapOptions } from '../src/bootstrap/EcsBootstrapService'

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
  }
  const indexer = {
    getEcosystem: vi.fn().mockResolvedValue({ id: 1, did: 'did:example:eco', archived: null }),
    getCredentialSchema: vi.fn().mockResolvedValue(serviceSchema),
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
    },
    dependencyManager: { resolve: () => vtFlowApi },
    didcomm: {
      oob: { receiveImplicitInvitation: vi.fn().mockResolvedValue({ connectionRecord: { id: 'conn-1' } }) },
      connections: { returnWhenIsConnected: vi.fn().mockResolvedValue({ id: 'conn-1' }) },
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
    { mode: 'standalone', trustedEcosystemId: 1, ...options },
    logger as never,
  )
}

describe('EcsBootstrapService standalone', () => {
  it.each([
    ['TRUSTED_ECS_ECOSYSTEM_ID is not set', {}, { trustedEcosystemId: undefined }],
    ['no OperatorAuthorization', { oas: [] }, {}],
    ['no balance', { balance: '0' }, {}],
    ['ecosystem unknown', { ecosystem: undefined }, {}],
  ])('skips without starting anything when %s', async (_name, mockTweaks, optionTweaks) => {
    const mocks = makeMocks()
    if ('oas' in mockTweaks) mocks.chain.listOperatorAuthorizations.mockResolvedValue([])
    if ('balance' in mockTweaks) mocks.chain.getBalance.mockResolvedValue({ denom: 'uvna', amount: '0' })
    if ('ecosystem' in mockTweaks) mocks.indexer.getEcosystem.mockResolvedValue(undefined)

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

    await makeService(mocks).run()

    expect(mocks.chain.startParticipantOP).toHaveBeenCalledTimes(2)
    const [holderCall, issuerCall] = mocks.chain.startParticipantOP.mock.calls
    expect(holderCall[0]).toMatchObject({ role: 6, validatorParticipantId: 2, did: 'did:web:agent' })
    expect(issuerCall[0]).toMatchObject({ role: 1, validatorParticipantId: 1 })
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

describe('EcsBootstrapService delegated', () => {
  const delegated = { mode: 'delegated' as const, delegatedParentVsDid: 'did:web:parent' }

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

  it('fails when the parent is unreachable', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockResolvedValue([{ id: 3, schema_id: 5 }])
    mocks.agent.didcomm.oob.receiveImplicitInvitation.mockRejectedValue(new Error('no endpoint'))
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })
    await expect(service.run()).rejects.toThrow('did:web:parent is unreachable: no endpoint')
  })

  it('sends the issuance request and resolves when the flow completes', async () => {
    const mocks = makeMocks()
    mocks.indexer.listParticipants.mockResolvedValue([{ id: 3, schema_id: 5 }])
    const service = makeService(mocks, { ...delegated, verifyPeer: async () => true })

    const outcome = service.run()
    await vi.waitFor(() => expect(mocks.vtFlowApi.sendIssuanceRequest).toHaveBeenCalled())
    expect(mocks.vtFlowApi.sendIssuanceRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-1', schemaId: '5' }),
    )
    for (const cb of mocks.eventHandlers) {
      void cb({ payload: { vtFlowRecordId: 'rec-1', state: VtFlowState.Completed } })
    }
    await expect(outcome).resolves.toBeUndefined()
  })
})
