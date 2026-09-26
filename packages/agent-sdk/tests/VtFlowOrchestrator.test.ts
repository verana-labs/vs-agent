import { VtFlowRole } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { ValidationState } from '../src/blockchain/types'
import { VtFlowOrchestrator } from '../src/vtFlow/VtFlowOrchestrator'

const record = {
  id: 'rec-1',
  role: VtFlowRole.Applicant,
  participantSessionId: 'sess-1',
  credentialExchangeRecordId: 'cx-1',
  schemaId: '5',
}

const activeIssuer = { id: 10, role: 'ISSUER', participant_state: 'ACTIVE', schema_id: 5 }

const SERVICE_SCHEMA = JSON.stringify({ title: 'ServiceCredential' })

function verify(indexer: Record<string, unknown>, setEcsSchemaKey = vi.fn(async () => undefined)) {
  const agent: Record<string, unknown> = {
    dependencyManager: { resolve: () => ({ findById: async () => record, setEcsSchemaKey }) },
    didcomm: {
      credentials: {
        // verre only digests JSON-LD, so the received credential must at least carry its context
        getFormatData: async () => ({
          credential: {
            dataIntegrity: { credential: { '@context': ['https://www.w3.org/ns/credentials/v2'] } },
          },
        }),
      },
    },
  }
  const defaults = {
    getParticipantSession: async () => ({ session_records: [{ issuer_participant_id: 10 }] }),
    getParticipant: async () => activeIssuer,
    getCredentialSchema: async () => ({ id: 5, digest_algorithm: 'sha384' }),
    getDigest: async () => ({ digest: 'anchored' }),
  }
  agent.indexer = { ...defaults, ...indexer }
  return new VtFlowOrchestrator(agent as never).verifyOfferedCredential('rec-1')
}

describe('VtFlowOrchestrator.verifyOfferedCredential', () => {
  it('accepts a credential issued by an active ISSUER for the schema and anchored on-chain', async () => {
    await expect(verify({})).resolves.toBeUndefined()
  })

  it('rejects when the validator is not an ISSUER', async () => {
    await expect(
      verify({ getParticipant: async () => ({ ...activeIssuer, role: 'VERIFIER' }) }),
    ).rejects.toThrow(/is not an ISSUER/)
  })

  it('rejects when the validator participant is not active', async () => {
    await expect(
      verify({ getParticipant: async () => ({ ...activeIssuer, participant_state: 'REVOKED' }) }),
    ).rejects.toThrow(/is not active/)
  })

  it('rejects when the participant schema does not match the credential schema', async () => {
    await expect(
      verify({ getParticipant: async () => ({ ...activeIssuer, schema_id: 99 }) }),
    ).rejects.toThrow(/does not match credential schema/)
  })

  it('rejects when the credential digest is not anchored on-chain', async () => {
    await expect(verify({ getDigest: async () => undefined })).rejects.toThrow(/not anchored on-chain/)
  })

  it('refuses to guess an algorithm when the schema does not declare one', async () => {
    await expect(verify({ getCredentialSchema: async () => ({ id: 5 }) })).rejects.toThrow(
      /has no digest_algorithm/,
    )
  })

  it('stores the ECS key of the schema, so publication needs no indexer', async () => {
    const setEcsSchemaKey = vi.fn(async () => undefined)

    await verify(
      {
        getCredentialSchema: async () => ({ id: 5, digest_algorithm: 'sha384', json_schema: SERVICE_SCHEMA }),
      },
      setEcsSchemaKey,
    )

    expect(setEcsSchemaKey).toHaveBeenCalledWith('rec-1', 'ecs-service')
  })

  it('stores no ECS key for a schema that is not an ECS one', async () => {
    const setEcsSchemaKey = vi.fn(async () => undefined)

    await verify({}, setEcsSchemaKey)

    expect(setEcsSchemaKey).not.toHaveBeenCalled()
  })

  it('digests the credential without an algorithm prefix', async () => {
    let looked: string | undefined
    await verify({
      getDigest: async (d: string) => {
        looked = d
        return { digest: d }
      },
    })
    expect(looked).toBeDefined()
    expect(looked).not.toMatch(/^sha\d+-/)
  })
})

describe('VtFlowOrchestrator.startOnboardingProcess renewal/reconnection', () => {
  const holder = {
    id: 5,
    did: 'did:web:agent',
    role: 1,
    validatorParticipantId: 9,
    schemaId: 12,
    opState: ValidationState.VALIDATED,
  }
  const validator = { id: 9, did: 'did:web:validator' }
  const openConnection = {
    id: 'conn-old',
    isReady: true,
    theirDid: 'did:web:validator',
    invitationDid: 'did:web:validator',
    previousTheirDids: [],
  }
  const rotatedConnection = {
    id: 'conn-old',
    isReady: true,
    theirDid: 'did:peer:4zQmRotated',
    invitationDid: 'did:web:validator',
    previousTheirDids: ['did:web:validator'],
  }

  const runningFlow = (state: string) => ({
    id: 'rec-1',
    participantSessionId: 'sess-old',
    connectionId: 'conn-old',
    state,
    createdAt: new Date(0),
  })

  function makeAgent(previousConnection: unknown, participant = holder) {
    const vtFlowApi = {
      findAllByQuery: vi.fn().mockResolvedValue([
        {
          participantSessionId: 'sess-old',
          connectionId: 'conn-old',
          state: 'COMPLETED',
          createdAt: new Date(0),
        },
      ]),
      sendOnboardingRequest: vi.fn().mockResolvedValue({ id: 'rec-2' }),
      resendOnboardingRequest: vi.fn().mockResolvedValue({ id: 'rec-1' }),
    }
    const agent = {
      did: 'did:web:agent',
      publicApiBaseUrl: 'https://agent.example',
      dids: { getCreatedDids: vi.fn(async () => []) },
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      indexer: { findParticipant: vi.fn(async (id: number) => (Number(id) === 5 ? participant : validator)) },
      veranaChain: {
        startParticipantOP: vi.fn(async () => ({ participantId: 5, txHash: 'AA' })),
        renewParticipantOP: vi.fn(async () => ({ txHash: 'BB' })),
      },
      dependencyManager: { resolve: () => vtFlowApi },
      context: { resolve: () => ({ update: vi.fn().mockResolvedValue(undefined) }) },
      didcomm: {
        connections: {
          findById: vi.fn().mockResolvedValue(previousConnection),
          findAllByQuery: vi.fn().mockResolvedValue([]),
          returnWhenIsConnected: vi.fn().mockResolvedValue({ id: 'conn-new' }),
          deleteById: vi.fn().mockResolvedValue(undefined),
        },
        oob: {
          receiveImplicitInvitation: vi
            .fn()
            .mockResolvedValue({ connectionRecord: { id: 'conn-new', setTag: vi.fn() } }),
        },
      },
    }
    return { agent, vtFlowApi }
  }

  it('reuses the previous session id and open connection', async () => {
    const { agent, vtFlowApi } = makeAgent(openConnection)

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-old', participantSessionId: 'sess-old' }),
    )
  })

  it('records the schema of the applicant entry on the flow', async () => {
    const { agent, vtFlowApi } = makeAgent(openConnection)

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(expect.objectContaining({ schemaId: '12' }))
  })

  it('reuses the open connection after the validator rotated to a did:peer', async () => {
    const { agent, vtFlowApi } = makeAgent(rotatedConnection)

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-old', participantSessionId: 'sess-old' }),
    )
  })

  it('ignores a ready connection whose peer is not the validator', async () => {
    const { agent, vtFlowApi } = makeAgent({
      id: 'conn-old',
      isReady: true,
      theirDid: 'did:peer:4zQmOther',
      invitationDid: 'did:peer:4zQmOther',
      previousTheirDids: [],
    })

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ did: 'did:web:validator' }),
    )
    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-new', participantSessionId: 'sess-old' }),
    )
  })

  it('opens a new connection but keeps the session id when the previous connection is gone', async () => {
    const { agent, vtFlowApi } = makeAgent(null)

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).toHaveBeenCalled()
    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-new', participantSessionId: 'sess-old' }),
    )
  })

  it('does not resend while a flow is in progress on an open connection', async () => {
    const { agent, vtFlowApi } = makeAgent(rotatedConnection)
    const inFlight = runningFlow('CRED_OFFERED')
    vtFlowApi.findAllByQuery.mockResolvedValue([inFlight])

    const result = await new VtFlowOrchestrator(agent as never).startOnboardingProcess({
      applicantParticipantId: 5,
    })

    expect(result).toBe(inFlight)
    expect(vtFlowApi.sendOnboardingRequest).not.toHaveBeenCalled()
    expect(vtFlowApi.resendOnboardingRequest).not.toHaveBeenCalled()
    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
  })

  it('renews a flow left in VALIDATED for a role other than HOLDER instead of treating it as running', async () => {
    const { agent, vtFlowApi } = makeAgent(openConnection)
    vtFlowApi.findAllByQuery.mockResolvedValue([{ ...runningFlow('VALIDATED'), applicantParticipantRole: 1 }])

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-old', participantSessionId: 'sess-old' }),
    )
    expect(vtFlowApi.resendOnboardingRequest).not.toHaveBeenCalled()
  })

  it('reconnects and resends the request of a running flow whose connection is gone', async () => {
    const { agent, vtFlowApi } = makeAgent(null)
    vtFlowApi.findAllByQuery.mockResolvedValue([runningFlow('VALIDATING')])

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).toHaveBeenCalled()
    expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledWith({
      vtFlowRecordId: 'rec-1',
      connectionId: 'conn-new',
    })
    expect(vtFlowApi.sendOnboardingRequest).not.toHaveBeenCalled()
  })

  it('resends an undelivered request on the open connection while the participant is still PENDING', async () => {
    const { agent, vtFlowApi } = makeAgent(openConnection, { ...holder, opState: ValidationState.PENDING })
    vtFlowApi.findAllByQuery.mockResolvedValue([runningFlow('OR_SENT')])

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
    expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledWith({
      vtFlowRecordId: 'rec-1',
      connectionId: 'conn-old',
    })
  })
})

describe('VtFlowOrchestrator onboarding validation', () => {
  const validatorRecord = {
    id: 'rec-v',
    role: VtFlowRole.Validator,
    variant: 'onboarding-process',
    state: 'AWAITING_OR',
    applicantParticipantId: '94',
    claims: {},
  }

  function makeAgent(role: number, recordOverrides: Record<string, unknown> = {}) {
    const flowRecord = { ...validatorRecord, ...recordOverrides }
    const vtFlowApi = {
      findById: vi.fn(async () => flowRecord),
      acceptOnboardingRequest: vi.fn(async () => flowRecord),
      markValidated: vi.fn(async () => ({ ...flowRecord, state: 'VALIDATED' })),
      markCompleted: vi.fn(async () => ({ ...flowRecord, state: 'COMPLETED' })),
      offerCredentialForSession: vi.fn(async () => ({
        record: { ...flowRecord, state: 'CRED_OFFERED' },
      })),
    }
    const agent = {
      did: 'did:web:validator',
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      dependencyManager: { resolve: () => vtFlowApi },
      indexer: {
        findParticipant: vi.fn(async () => ({
          id: 94,
          role,
          schemaId: 22,
          did: 'did:web:applicant',
          corporation: 'verana1corp',
          validatorParticipantId: 93,
        })),
      },
      veranaChain: {
        setParticipantOPToValidated: vi.fn(async () => undefined),
      },
    }
    return { agent, vtFlowApi }
  }

  /** buildCredential needs an indexer and a schema; assert the wiring, not the credential body. */
  function stubBuildCredential(
    orchestrator: VtFlowOrchestrator,
    build: () => Promise<unknown> = async () => ({ id: 'urn:cred' }),
  ) {
    const spy = vi.fn(build)
    ;(orchestrator as unknown as { buildCredential: unknown }).buildCredential = spy
    return spy
  }

  it('validateOnboardingProcess records the outcome on-chain and offers no credential', async () => {
    const { agent, vtFlowApi } = makeAgent(1) // ISSUER

    const { record, participant } = await new VtFlowOrchestrator(agent as never).validateOnboardingProcess({
      vtFlowRecordId: 'rec-v',
    })

    expect(agent.veranaChain.setParticipantOPToValidated).toHaveBeenCalledWith({
      id: 94,
      corporation: 'verana1corp',
    })
    expect(vtFlowApi.acceptOnboardingRequest).toHaveBeenCalledWith('rec-v')
    expect(vtFlowApi.markValidated).toHaveBeenCalledWith('rec-v')
    expect(vtFlowApi.offerCredentialForSession).not.toHaveBeenCalled()
    expect(record.state).toBe('VALIDATED')
    // The caller decides what follows from the role.
    expect(participant.role).toBe(1)
  })

  it('validateOnboardingProcess reports the HOLDER role so the caller can offer a credential', async () => {
    const { agent } = makeAgent(6) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    stubBuildCredential(orchestrator)

    const { participant, credential } = await orchestrator.validateOnboardingProcess({
      vtFlowRecordId: 'rec-v',
    })

    expect(participant.role).toBe(6)
    expect(credential).toEqual({ id: 'urn:cred' })
  })

  it('validateOnboardingProcess builds the HOLDER credential before it writes to the chain', async () => {
    const { agent } = makeAgent(6) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    const order: string[] = []
    stubBuildCredential(orchestrator, async () => {
      order.push('build')
      return { id: 'urn:cred' }
    })
    agent.veranaChain.setParticipantOPToValidated = vi.fn(async () => {
      order.push('chain')
      return undefined
    })

    await orchestrator.validateOnboardingProcess({ vtFlowRecordId: 'rec-v' })

    expect(order).toEqual(['build', 'chain'])
  })

  it('validateOnboardingProcess leaves the flow repeatable when the HOLDER credential fails', async () => {
    const { agent, vtFlowApi } = makeAgent(6) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    stubBuildCredential(orchestrator, async () => {
      throw new Error('claims do not satisfy the schema')
    })

    await expect(orchestrator.validateOnboardingProcess({ vtFlowRecordId: 'rec-v' })).rejects.toThrow(
      /claims do not satisfy the schema/,
    )
    expect(agent.veranaChain.setParticipantOPToValidated).not.toHaveBeenCalled()
    expect(vtFlowApi.acceptOnboardingRequest).not.toHaveBeenCalled()
    expect(vtFlowApi.markValidated).not.toHaveBeenCalled()
  })

  it('validateOnboardingProcess re-drives a VALIDATED record that has no credential exchange', async () => {
    const { agent, vtFlowApi } = makeAgent(6, { state: 'VALIDATED' }) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    stubBuildCredential(orchestrator)

    const { record, credential } = await orchestrator.validateOnboardingProcess({
      vtFlowRecordId: 'rec-v',
    })

    // The chain already holds the outcome, so only the credential is built again.
    expect(agent.veranaChain.setParticipantOPToValidated).not.toHaveBeenCalled()
    expect(vtFlowApi.markValidated).not.toHaveBeenCalled()
    expect(record.state).toBe('VALIDATED')
    expect(credential).toEqual({ id: 'urn:cred' })
  })

  it('validateOnboardingProcess rejects a VALIDATED record that has a credential exchange', async () => {
    const { agent } = makeAgent(6, { state: 'VALIDATED', credentialExchangeRecordId: 'cx-1' })
    const orchestrator = new VtFlowOrchestrator(agent as never)
    stubBuildCredential(orchestrator)

    await expect(orchestrator.validateOnboardingProcess({ vtFlowRecordId: 'rec-v' })).rejects.toThrow(
      /Record state is 'VALIDATED'/,
    )
  })

  it('offerOnboardingCredential offers against the validator participant', async () => {
    const { agent, vtFlowApi } = makeAgent(6) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    stubBuildCredential(orchestrator)

    const offered = await orchestrator.offerOnboardingCredential({
      vtFlowRecordId: 'rec-v',
      credentialSchemaId: '22',
    })

    expect(vtFlowApi.offerCredentialForSession).toHaveBeenCalledWith(
      expect.objectContaining({ vtFlowRecordId: 'rec-v', issuerParticipantId: 93 }),
    )
    expect(offered.state).toBe('CRED_OFFERED')
  })

  it('offerOnboardingCredential sends the credential that validateOnboardingProcess built', async () => {
    const { agent, vtFlowApi } = makeAgent(6) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    const build = stubBuildCredential(orchestrator)

    await orchestrator.offerOnboardingCredential({
      vtFlowRecordId: 'rec-v',
      credential: { id: 'urn:prebuilt' } as never,
    })

    expect(build).not.toHaveBeenCalled()
    expect(vtFlowApi.offerCredentialForSession).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialFormats: expect.objectContaining({
          dataIntegrity: expect.objectContaining({
            credential: { id: 'urn:prebuilt' },
            bindingRequired: false,
          }),
        }),
      }),
    )
  })

  it('completeOnboardingProcess closes a flow that carries no credential', async () => {
    const { agent, vtFlowApi } = makeAgent(1) // ISSUER

    const completed = await new VtFlowOrchestrator(agent as never).completeOnboardingProcess('rec-v')

    expect(vtFlowApi.markCompleted).toHaveBeenCalledWith('rec-v')
    expect(completed.state).toBe('COMPLETED')
  })
})

describe('VtFlowOrchestrator.allowEcsIssuanceExemption', () => {
  const context = {
    agentContext: { config: { logger: { warn: vi.fn() } } },
    peerDid: 'did:web:peer',
    purpose: { participantId: '42' },
  } as never

  it('resolves the peer participant against the indexer with the agent DID known at call time', async () => {
    const indexer = {
      getParticipant: vi.fn().mockResolvedValue(undefined),
      getCredentialSchema: vi.fn(),
      getEcosystem: vi.fn(),
      listParticipants: vi.fn(),
    }
    const agent = { did: undefined as string | undefined, indexer }
    const orchestrator = new VtFlowOrchestrator(agent as never)

    await expect(orchestrator.checkEcsIssuanceExemption(context)).resolves.toBe(false)
    expect(indexer.getParticipant).not.toHaveBeenCalled()

    agent.did = 'did:webvh:scid:agent.example'
    await expect(orchestrator.checkEcsIssuanceExemption(context)).resolves.toBe(false)
    expect(indexer.getParticipant).toHaveBeenCalledWith(42)
  })
})

describe('VtFlowOrchestrator validateFlow', () => {
  const SET_VALIDATED = '/verana.pp.v1.MsgSetParticipantOPToValidated'
  const now = Date.now()
  const past = new Date(now - 86_400_000).toISOString()

  function makeValidateAgent(
    options: {
      state?: string
      applicant?: Record<string, unknown>
      grant?: { msgTypes: string[]; withFeegrant: boolean } | null
      balance?: string
      claims?: Record<string, unknown>
      jsonSchema?: Record<string, unknown>
    } = {},
  ) {
    let flowRecord: Record<string, unknown> = {
      id: 'rec-v',
      role: VtFlowRole.Validator,
      variant: 'onboarding-process',
      state: options.state ?? 'VALIDATING',
      applicantParticipantId: '94',
      claims: options.claims ?? { name: 'Acme' },
    }
    const vtFlowApi = {
      findById: vi.fn(async () => flowRecord),
      findAllByQuery: vi.fn(async () => []),
      acceptOnboardingRequest: vi.fn(async () => flowRecord),
      sendValidating: vi.fn(async () => flowRecord),
      markValidated: vi.fn(async () => {
        flowRecord = { ...flowRecord, state: 'VALIDATED' }
        return flowRecord
      }),
      markCompleted: vi.fn(async () => ({ ...flowRecord, state: 'COMPLETED' })),
      recordValidation: vi.fn(async (_id: string, validation: unknown, state?: string) => {
        flowRecord = { ...flowRecord, validation, ...(state && { state }) }
        return flowRecord
      }),
    }
    const applicant = {
      id: 94,
      role: 'ISSUER',
      schema_id: 22,
      did: 'did:web:applicant',
      op_state: 'PENDING',
      effective_from: null,
      validator_participant_id: 93,
      ...options.applicant,
    }
    const validator = { id: 93, effective_from: past, effective_until: null, revoked: null, slashed: null }
    const chain = {
      corporation: 'verana1corp',
      setParticipantOPToValidatedMsg: vi.fn(params => ({ typeUrl: SET_VALIDATED, value: params })),
      estimateFee: vi.fn(async () => ({ amount: [{ denom: 'uvna', amount: '500' }], gas: '200000' })),
      feeAllowance: vi.fn(async () => undefined),
      broadcastWithoutWaiting: vi.fn(async () => 'AB12'),
      getBalance: vi.fn(async () => ({ denom: 'uvna', amount: options.balance ?? '1000' })),
      findTx: vi.fn(async () => undefined),
    }
    const agent = {
      did: 'did:web:validator',
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      dependencyManager: { resolve: () => vtFlowApi },
      veranaChain: chain,
      authorizationService:
        options.grant === null
          ? undefined
          : {
              refreshForOperator: vi.fn(async () => undefined),
              getVsOperatorAuthorizationRecord: vi.fn(
                () => options.grant ?? { msgTypes: [SET_VALIDATED], withFeegrant: false },
              ),
            },
      indexer: {
        getParticipant: vi.fn(async (id: string | number) => (Number(id) === 93 ? validator : applicant)),
        findParticipant: vi.fn(async () => ({ id: 94, role: 1, did: 'did:web:applicant' })),
        getCredentialSchema: vi.fn(async () => ({
          json_schema: JSON.stringify(
            options.jsonSchema ?? {
              properties: {
                credentialSubject: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: { id: { type: 'string' }, name: { type: 'string' } },
                },
              },
            },
          ),
          holder_validation_validity_period: 365,
        })),
      },
    }
    return { agent, vtFlowApi, chain, current: () => flowRecord }
  }

  it('hands the transaction to an operator when the agent holds no grant for it', async () => {
    const { agent, chain, current } = makeValidateAgent({ grant: { msgTypes: [], withFeegrant: false } })

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v', validationFees: 5 })

    expect(current().state).toBe('AWAITING_VALIDATION_TX')
    expect(current().validation).toMatchObject({ submission: 'OPERATOR', validationFees: 5 })
    expect(chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
  })

  it('broadcasts under its grant and returns before the transaction lands', async () => {
    const { agent, chain, current } = makeValidateAgent()

    await new VtFlowOrchestrator(agent as never).validateFlow({
      vtFlowRecordId: 'rec-v',
      issuanceFeeDiscount: 0.25,
    })

    expect(chain.setParticipantOPToValidatedMsg).toHaveBeenCalledWith(
      expect.objectContaining({ id: 94, issuanceFeeDiscount: 2500 }),
    )
    expect(current().state).toBe('VALIDATION_TX_SUBMITTED')
    expect(current().validation).toMatchObject({
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'SUBMITTED' },
    })
  })

  it('records a failed pre-flight without broadcasting', async () => {
    const { agent, chain, current } = makeValidateAgent({ balance: '100' })

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
    expect(current().state).toBe('VALIDATION_TX_FAILED')
    expect(current().validation).toMatchObject({
      tx: { status: 'FAILED', reason: 'INSUFFICIENT_FUNDS_AGENT' },
    })
  })

  it('records a failed simulation as a pre-flight error', async () => {
    const { agent, chain, current } = makeValidateAgent()
    chain.estimateFee.mockRejectedValue(new Error('out of gas'))

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
    expect(current()).toMatchObject({
      state: 'VALIDATION_TX_FAILED',
      validation: { tx: { status: 'FAILED', reason: 'PREFLIGHT_ERROR', error: 'out of gas' } },
    })
  })

  it('records a failed pre-flight when a balance read fails', async () => {
    const own = makeValidateAgent()
    own.chain.getBalance.mockRejectedValue(new Error('rpc unavailable'))
    await new VtFlowOrchestrator(own.agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    const granted = makeValidateAgent({ grant: { msgTypes: [SET_VALIDATED], withFeegrant: true } })
    granted.chain.feeAllowance.mockResolvedValue({ unlimited: true } as never)
    Object.assign(granted.chain, {
      getAccountBalance: vi.fn().mockRejectedValue(new Error('rpc unavailable')),
    })
    await new VtFlowOrchestrator(granted.agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    for (const { chain, current } of [own, granted]) {
      expect(chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
      expect(current().state).toBe('VALIDATION_TX_FAILED')
      expect(current().validation).toMatchObject({
        tx: { status: 'FAILED', reason: 'PREFLIGHT_ERROR', error: 'rpc unavailable' },
      })
    }
  })

  it('records a failed pre-flight when the allowance read fails', async () => {
    const { agent, chain, current } = makeValidateAgent({
      grant: { msgTypes: [SET_VALIDATED], withFeegrant: true },
    })
    chain.feeAllowance.mockRejectedValue(new Error('rpc unavailable'))

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(chain.estimateFee).not.toHaveBeenCalled()
    expect(current()).toMatchObject({
      state: 'VALIDATION_TX_FAILED',
      validation: { tx: { status: 'FAILED', reason: 'PREFLIGHT_ERROR', error: 'rpc unavailable' } },
    })
  })

  it('reports an expired feegrant before it simulates, since the simulation fails on it first', async () => {
    const { agent, chain, current } = makeValidateAgent({
      grant: { msgTypes: [SET_VALIDATED], withFeegrant: true },
    })
    chain.estimateFee.mockRejectedValue(new Error('fee-grant not found'))

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(chain.estimateFee).not.toHaveBeenCalled()
    expect(current().validation).toMatchObject({ tx: { status: 'FAILED', reason: 'FEEGRANT_EXPIRED' } })
  })

  it('refuses claims that do not fit the schema, with the violations, and records nothing', async () => {
    const { agent, vtFlowApi } = makeValidateAgent({ applicant: { role: 'HOLDER' }, claims: {} })

    const failure = await new VtFlowOrchestrator(agent as never)
      .validateFlow({ vtFlowRecordId: 'rec-v' })
      .catch(error => error)

    expect(failure).toMatchObject({
      code: 'INVALID_CLAIMS',
      status: 422,
      details: { violations: [expect.objectContaining({ message: expect.stringContaining('name') })] },
    })
    expect(vtFlowApi.recordValidation).not.toHaveBeenCalled()
  })

  it('keeps the agreed terms on a renewal and refuses a different one', async () => {
    const renewal = { effective_from: past, validation_fees: 7, issuance_fee_discount: 0.1235 }

    const refused = makeValidateAgent({ applicant: renewal })
    await expect(
      new VtFlowOrchestrator(refused.agent as never).validateFlow({
        vtFlowRecordId: 'rec-v',
        validationFees: 8,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const kept = makeValidateAgent({ applicant: renewal })
    await new VtFlowOrchestrator(kept.agent as never).validateFlow({
      vtFlowRecordId: 'rec-v',
      issuanceFeeDiscount: 0.12345,
    })
    expect(kept.current().validation).toMatchObject({ validationFees: 7, issuanceFeeDiscount: 0.1235 })
  })

  it('skips the submission when the entry is already VALIDATED on chain, and takes the terms from it', async () => {
    const modified = '2026-09-25T10:00:00Z'
    const { agent, chain, current } = makeValidateAgent({
      applicant: { op_state: 'VALIDATED', modified, validation_fees: 4, issuance_fee_discount: 0.5 },
    })

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
    expect(current()).toMatchObject({
      state: 'VALIDATED',
      validation: {
        decidedAt: modified,
        submission: 'OPERATOR',
        validationFees: 4,
        issuanceFeeDiscount: 0.5,
      },
    })
  })

  it('records OPERATOR when the entry is VALIDATED after the agent transaction failed', async () => {
    const { agent, vtFlowApi, current } = makeValidateAgent({
      state: 'VALIDATION_TX_FAILED',
      applicant: { op_state: 'VALIDATED' },
    })
    await vtFlowApi.recordValidation('rec-v', {
      decidedAt: past,
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'FAILED', reason: 'TX_FAILED' },
    })

    await new VtFlowOrchestrator(agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(current()).toMatchObject({
      state: 'VALIDATED',
      validation: { submission: 'OPERATOR', tx: { hash: 'AB12', status: 'FAILED' } },
    })
  })

  it('refuses to move a flow to VALIDATED once it has left the states before it', async () => {
    const { agent, vtFlowApi } = makeValidateAgent({ state: 'CRED_OFFERED' })

    await expect(
      new VtFlowOrchestrator(agent as never).markValidated('rec-v', { op_state: 'VALIDATED' } as never),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect(vtFlowApi.recordValidation).not.toHaveBeenCalled()
  })

  function makeHolderRenewal(state: string) {
    const setup = makeValidateAgent({
      state,
      applicant: { role: 'HOLDER', op_state: 'VALIDATED', effective_from: past },
    })
    setup.current().credentialExchangeRecordId = 'cx-previous-round'
    setup.agent.indexer.findParticipant.mockResolvedValue({
      id: 94,
      role: 6,
      did: 'did:web:applicant',
    } as never)
    const orchestrator = new VtFlowOrchestrator(setup.agent as never)
    const offer = vi.fn(async () => setup.current())
    ;(orchestrator as unknown as { offerOnboardingCredential: unknown }).offerOnboardingCredential = offer
    return { ...setup, orchestrator, offer }
  }

  it('offers the updated credential of a HOLDER renewal once its transaction lands', async () => {
    const { orchestrator, agent, vtFlowApi, chain, current, offer } =
      makeHolderRenewal('VALIDATION_TX_SUBMITTED')
    await vtFlowApi.recordValidation('rec-v', {
      decidedAt: new Date().toISOString(),
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'SUBMITTED' },
    })
    chain.findTx.mockResolvedValue({ code: 0, height: 7, rawLog: '' } as never)
    agent.indexer.getParticipant.mockResolvedValue({ op_state: 'VALIDATED', validation_fees: 6 } as never)

    await orchestrator.resolveValidationTx('rec-v')

    expect(current().validation).toMatchObject({
      submission: 'AGENT',
      validationFees: 6,
      tx: { hash: 'AB12', height: 7, status: 'SUCCEEDED' },
    })
    expect(offer).toHaveBeenCalledWith(expect.objectContaining({ vtFlowRecordId: 'rec-v' }))
  })

  it('resumes a HOLDER renewal whose entry is already VALIDATED into issuance', async () => {
    const { orchestrator, chain, offer } = makeHolderRenewal('VALIDATION_TX_SUBMITTED')

    await orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
    expect(offer).toHaveBeenCalledWith(expect.objectContaining({ vtFlowRecordId: 'rec-v' }))
  })

  it('holds the issuance of a VALIDATED flow with a TERMINATED connection until the applicant reconnects', async () => {
    const { orchestrator, current, offer } = makeHolderRenewal('VALIDATED')
    current().connectionTerminated = true

    await expect(orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
      status: 409,
    })
    expect(offer).not.toHaveBeenCalled()

    current().connectionTerminated = undefined
    await orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })
    expect(offer).toHaveBeenCalledWith(expect.objectContaining({ vtFlowRecordId: 'rec-v' }))
  })

  it('moves a flow rejected with its transaction in flight to VALIDATED once the entry is, and issues nothing', async () => {
    const { orchestrator, vtFlowApi, current, offer } = makeHolderRenewal('TERMINATED_BY_VALIDATOR')
    Object.assign(current(), {
      connectionTerminated: true,
      createdAt: new Date(now - 60_000),
      validation: { decidedAt: past, submission: 'OPERATOR' },
    })
    const newer = { id: 'rec-newer', createdAt: new Date(now) }
    vtFlowApi.findAllByQuery.mockResolvedValue([current(), newer] as never)

    await expect(orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })

    vtFlowApi.findAllByQuery.mockResolvedValue([current()] as never)
    const validated = await orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(validated).toMatchObject({
      state: 'VALIDATED',
      connectionTerminated: true,
      validation: { submission: 'OPERATOR' },
    })
    expect(offer).not.toHaveBeenCalled()
  })

  function makeDirectIssuance(claims: Record<string, unknown>) {
    const setup = makeValidateAgent({ claims })
    const record = setup.current()
    record.variant = 'direct-issuance'
    record.schemaId = '22'
    record.connectionId = 'conn-1'
    const offerCredentialForSession = vi.fn(async () => ({ record: { ...record, state: 'CRED_OFFERED' } }))
    Object.assign(setup.vtFlowApi, { offerCredentialForSession })
    Object.assign(setup.agent, {
      didcomm: { connections: { findById: vi.fn(async () => ({ theirDid: 'did:web:holder' })) } },
    })
    const orchestrator = new VtFlowOrchestrator(setup.agent as never)
    ;(orchestrator as unknown as { buildDirectIssuanceOffer: unknown }).buildDirectIssuanceOffer = vi.fn(
      async () => ({ credentialFormats: {}, issuerParticipantId: 93 }),
    )
    return { ...setup, orchestrator, offerCredentialForSession }
  }

  it('offers a Direct Issuance credential without any chain transaction', async () => {
    const { orchestrator, chain, offerCredentialForSession } = makeDirectIssuance({ name: 'Acme' })

    const offered = await orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(offered.state).toBe('CRED_OFFERED')
    expect(offerCredentialForSession).toHaveBeenCalledWith(
      expect.objectContaining({ vtFlowRecordId: 'rec-v', issuerParticipantId: 93 }),
    )
    expect(chain.estimateFee).not.toHaveBeenCalled()
  })

  it('refuses Direct Issuance claims that do not fit the schema before offering', async () => {
    const { orchestrator, offerCredentialForSession } = makeDirectIssuance({})

    await expect(orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })).rejects.toMatchObject({
      code: 'INVALID_CLAIMS',
    })
    expect(offerCredentialForSession).not.toHaveBeenCalled()
  })

  it('refuses to leave OOB_PENDING while the flow connection is not ESTABLISHED', async () => {
    const onboarding = makeValidateAgent({ state: 'OOB_PENDING' })
    const findById = vi.fn(async () => ({ isReady: false }))
    Object.assign(onboarding.agent, { didcomm: { connections: { findById } } })
    const direct = makeDirectIssuance({ name: 'Acme' })
    direct.current().state = 'OOB_PENDING'

    for (const orchestrator of [new VtFlowOrchestrator(onboarding.agent as never), direct.orchestrator]) {
      await expect(orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })).rejects.toMatchObject({
        code: 'INVALID_STATE',
        status: 409,
      })
    }
    expect(onboarding.vtFlowApi.sendValidating).not.toHaveBeenCalled()
    expect(direct.vtFlowApi.sendValidating).not.toHaveBeenCalled()
    expect(direct.offerCredentialForSession).not.toHaveBeenCalled()

    findById.mockResolvedValue({ isReady: true })
    await new VtFlowOrchestrator(onboarding.agent as never).validateFlow({ vtFlowRecordId: 'rec-v' })
    expect(onboarding.vtFlowApi.sendValidating).toHaveBeenCalledWith('rec-v')
  })

  it('reads the entry before recording a transaction that was not found', async () => {
    const { agent, vtFlowApi, current } = makeValidateAgent({
      state: 'VALIDATION_TX_SUBMITTED',
      applicant: { op_state: 'VALIDATED', validation_fees: 2 },
    })
    await vtFlowApi.recordValidation('rec-v', {
      decidedAt: new Date(now - 120_000).toISOString(),
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'SUBMITTED' },
    })

    await new VtFlowOrchestrator(agent as never).resolveValidationTx('rec-v')

    expect(current()).toMatchObject({
      state: 'VALIDATED',
      validation: { submission: 'AGENT', validationFees: 2, tx: { hash: 'AB12', status: 'SUBMITTED' } },
    })
  })

  it('keeps the failed transaction and records OPERATOR when the entry is VALIDATED after a non-zero code', async () => {
    const { agent, vtFlowApi, chain, current } = makeValidateAgent({
      state: 'VALIDATION_TX_SUBMITTED',
      applicant: { op_state: 'VALIDATED' },
    })
    await vtFlowApi.recordValidation('rec-v', {
      decidedAt: past,
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'SUBMITTED' },
    })
    chain.findTx.mockResolvedValue({
      code: 5,
      height: 9,
      rawLog: 'participant must be in PENDING state to be validated',
    } as never)

    await new VtFlowOrchestrator(agent as never).resolveValidationTx('rec-v')

    expect(current()).toMatchObject({
      state: 'VALIDATED',
      validation: {
        submission: 'OPERATOR',
        tx: {
          hash: 'AB12',
          height: 9,
          status: 'FAILED',
          reason: 'TX_FAILED',
          error: 'participant must be in PENDING state to be validated',
        },
      },
    })
  })

  it('leaves a flow the notification moved to VALIDATED while the failed transaction was read', async () => {
    const { agent, vtFlowApi, chain, current } = makeValidateAgent({
      state: 'VALIDATION_TX_SUBMITTED',
      applicant: { op_state: 'VALIDATED' },
    })
    await vtFlowApi.recordValidation('rec-v', {
      decidedAt: past,
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'SUBMITTED' },
    })
    const handled = { decidedAt: past, submission: 'OPERATOR', tx: { hash: 'AB12', status: 'SUBMITTED' } }
    chain.findTx.mockImplementation(async () => {
      await vtFlowApi.recordValidation('rec-v', handled, 'VALIDATED')
      return { code: 5, height: 9, rawLog: 'participant must be in PENDING state to be validated' } as never
    })

    await new VtFlowOrchestrator(agent as never).resolveValidationTx('rec-v')

    expect(current()).toMatchObject({ state: 'VALIDATED', validation: handled })
  })

  it('counts the 60 seconds from the broadcast, not from the decision', async () => {
    const { agent, vtFlowApi, chain, current } = makeValidateAgent({ state: 'VALIDATION_TX_SUBMITTED' })
    await vtFlowApi.recordValidation('rec-v', {
      decidedAt: new Date(now - 120_000).toISOString(),
      submission: 'AGENT',
      tx: { hash: 'AB12', status: 'SUBMITTED', submittedAt: new Date().toISOString() },
    })
    chain.findTx.mockImplementation(async () => {
      current().state = 'VALIDATED'
      return undefined
    })

    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const resolving = new VtFlowOrchestrator(agent as never).resolveValidationTx('rec-v')
    await vi.runAllTimersAsync()
    await resolving
    vi.useRealTimers()

    expect(current()).toMatchObject({ state: 'VALIDATED', validation: { tx: { status: 'SUBMITTED' } } })
  })

  it('leaves a flow whose role receives no credential in VALIDATED', async () => {
    const { agent, vtFlowApi } = makeValidateAgent({ state: 'VALIDATED' })

    const record = await new VtFlowOrchestrator(agent as never).continueAfterValidated('rec-v')

    expect(record.state).toBe('VALIDATED')
    expect(vtFlowApi.markCompleted).not.toHaveBeenCalled()
  })

  it('holds a HOLDER flow whose claims fail the schema in VALIDATED_PENDING_CLAIMS and names each claim', async () => {
    const { agent, vtFlowApi } = makeValidateAgent({ state: 'VALIDATED', claims: { name: 7 } })
    agent.indexer.findParticipant.mockResolvedValue({
      id: 94,
      role: 6,
      schemaId: 22,
      did: 'did:web:applicant',
    } as never)
    const markPendingClaims = vi.fn(async () => ({ state: 'VALIDATED_PENDING_CLAIMS' }))
    Object.assign(vtFlowApi, { markPendingClaims })
    const orchestrator = new VtFlowOrchestrator(agent as never)
    const offer = vi.fn()
    ;(orchestrator as unknown as { offerOnboardingCredential: unknown }).offerOnboardingCredential = offer

    await orchestrator.continueAfterValidated('rec-v')

    expect(markPendingClaims).toHaveBeenCalledWith('rec-v')
    expect(offer).not.toHaveBeenCalled()
    expect(agent.config.logger.error).toHaveBeenCalledWith(expect.stringContaining('/name must be string'))
  })

  it('repeats the anchoring of a credential only while its issuance transaction is FAILED', async () => {
    const { agent, vtFlowApi, current } = makeValidateAgent({ state: 'CRED_OFFERED' })
    const issueCredentialForSession = vi.fn(async () => ({ record: current() }))
    Object.assign(vtFlowApi, { issueCredentialForSession })
    current().credentialExchangeRecordId = 'cx-1'
    const orchestrator = new VtFlowOrchestrator(agent as never)

    await expect(orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })

    current().issuance = { tx: { status: 'FAILED', reason: 'TX_FAILED' } }
    await orchestrator.validateFlow({ vtFlowRecordId: 'rec-v' })

    expect(issueCredentialForSession).toHaveBeenCalledTimes(1)
    expect(issueCredentialForSession).toHaveBeenCalledWith({
      vtFlowRecordId: 'rec-v',
      credentialExchangeRecordId: 'cx-1',
    })
  })
})

describe('VtFlowOrchestrator.onCredentialIssued', () => {
  const signed = { '@context': ['https://www.w3.org/ns/credentials/v2'] }

  function makeAnchorAgent(balance = '1000') {
    const chain = {
      corporation: 'verana1corp',
      createOrUpdateParticipantSessionMsg: vi.fn(params => ({ typeUrl: 'session', value: params })),
      estimateFee: vi.fn(async () => ({ amount: [{ denom: 'uvna', amount: '500' }], gas: '200000' })),
      getBalance: vi.fn(async () => ({ denom: 'uvna', amount: balance })),
      broadcastWithoutWaiting: vi.fn(async () => 'CD34'),
      findTx: vi.fn(async () => ({ code: 0, height: 12, rawLog: '' })),
    }
    const record: Record<string, unknown> = {
      id: 'rec-v',
      participantSessionId: 'sess-1',
      issuerParticipantId: 93,
    }
    const recordIssuance = vi.fn(async () => record)
    const agent = {
      dependencyManager: { resolve: () => ({ findById: async () => record, recordIssuance }) },
      indexer: {
        getParticipant: async () => ({ schema_id: 22 }),
        getCredentialSchema: async () => ({ digest_algorithm: 'sha384', json_schema: '{}' }),
      },
      veranaChain: chain,
    }
    return { orchestrator: new VtFlowOrchestrator(agent as never), chain, record, recordIssuance }
  }

  it('returns the anchoring transaction once it is included', async () => {
    const { orchestrator, chain } = makeAnchorAgent()

    const { credentialDigest, issuance } = await orchestrator.onCredentialIssued('rec-v', signed)

    expect(chain.createOrUpdateParticipantSessionMsg).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1', issuerParticipantId: 93, digest: credentialDigest }),
    )
    expect(issuance.tx).toMatchObject({ hash: 'CD34', height: 12, status: 'SUCCEEDED' })
  })

  it('records the anchoring SUBMITTED as soon as the broadcast is accepted', async () => {
    const { orchestrator, recordIssuance } = makeAnchorAgent()

    await orchestrator.onCredentialIssued('rec-v', signed)

    expect(recordIssuance).toHaveBeenCalledWith('rec-v', {
      tx: { hash: 'CD34', submittedAt: expect.any(String), status: 'SUBMITTED' },
    })
  })

  it('looks up an anchoring left SUBMITTED by a restart instead of broadcasting it again', async () => {
    const landed = makeAnchorAgent()
    landed.record.issuance = {
      tx: { hash: 'EF56', submittedAt: new Date().toISOString(), status: 'SUBMITTED' },
    }
    const { issuance } = await landed.orchestrator.onCredentialIssued('rec-v', signed)
    expect(landed.chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
    expect(landed.chain.findTx).toHaveBeenCalledWith('EF56')
    expect(issuance.tx).toMatchObject({ hash: 'EF56', height: 12, status: 'SUCCEEDED' })

    const lost = makeAnchorAgent()
    lost.chain.findTx.mockResolvedValue(undefined as never)
    lost.record.issuance = {
      tx: { hash: 'EF56', submittedAt: new Date(Date.now() - 120_000).toISOString(), status: 'SUBMITTED' },
    }
    const notFound = await lost.orchestrator.onCredentialIssued('rec-v', signed)
    expect(lost.chain.broadcastWithoutWaiting).not.toHaveBeenCalled()
    expect(notFound.issuance.tx).toMatchObject({ hash: 'EF56', status: 'FAILED', reason: 'TX_NOT_FOUND' })
  })

  it('resumes at startup only the flows whose anchoring was left SUBMITTED', async () => {
    const issueCredentialForSession = vi.fn(async () => ({}))
    const offered = [
      {
        id: 'rec-a',
        credentialExchangeRecordId: 'cx-a',
        issuance: { tx: { hash: 'A1', status: 'SUBMITTED' } },
      },
      { id: 'rec-b', credentialExchangeRecordId: 'cx-b', issuance: { tx: { status: 'FAILED' } } },
    ]
    const findAllByQuery = vi.fn(async () => offered)
    const agent = { dependencyManager: { resolve: () => ({ findAllByQuery, issueCredentialForSession }) } }

    await new VtFlowOrchestrator(agent as never).resumeIssuanceSubmissions()

    expect(findAllByQuery).toHaveBeenCalledWith({ role: VtFlowRole.Validator, flowState: 'CRED_OFFERED' })
    expect(issueCredentialForSession).toHaveBeenCalledTimes(1)
    expect(issueCredentialForSession).toHaveBeenCalledWith({
      vtFlowRecordId: 'rec-a',
      credentialExchangeRecordId: 'cx-a',
    })
  })

  it('lets the Corporation pay the anchoring when the grant of the issuer entry has with_feegrant', async () => {
    const { orchestrator, chain } = makeAnchorAgent()
    const getVsOperatorAuthorizationRecord = vi.fn(() => ({ withFeegrant: true }))
    Object.assign(chain, {
      feeAllowance: vi.fn(async () => ({ unlimited: true })),
      getAccountBalance: vi.fn(async () => ({ denom: 'uvna', amount: '1000' })),
    })
    Object.assign((orchestrator as unknown as { agent: object }).agent, {
      authorizationService: { getVsOperatorAuthorizationRecord },
    })

    await orchestrator.onCredentialIssued('rec-v', signed)

    expect(getVsOperatorAuthorizationRecord).toHaveBeenCalledWith(93)
    expect(chain.estimateFee).toHaveBeenCalledWith(expect.anything(), 'verana1corp')
  })

  it('returns a failed anchoring instead of throwing', async () => {
    const broke = makeAnchorAgent('100')
    const preflight = await broke.orchestrator.onCredentialIssued('rec-v', signed)
    expect(preflight.issuance.tx).toMatchObject({ status: 'FAILED', reason: 'INSUFFICIENT_FUNDS_AGENT' })
    expect(broke.chain.broadcastWithoutWaiting).not.toHaveBeenCalled()

    const rejected = makeAnchorAgent()
    rejected.chain.findTx.mockResolvedValue({ code: 5, height: 13, rawLog: 'digest exists' })
    const included = await rejected.orchestrator.onCredentialIssued('rec-v', signed)
    expect(included.issuance.tx).toMatchObject({
      hash: 'CD34',
      height: 13,
      status: 'FAILED',
      reason: 'TX_FAILED',
      error: 'digest exists',
    })
  })
})
