import { VtFlowRole } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { VtFlowOrchestrator } from '../src/vtFlow/VtFlowOrchestrator'

const record = {
  id: 'rec-1',
  role: VtFlowRole.Applicant,
  participantSessionId: 'sess-1',
  credentialExchangeRecordId: 'cx-1',
  schemaId: '5',
}

const activeIssuer = { id: 10, role: 'ISSUER', participant_state: 'ACTIVE', schema_id: 5 }

function verify(indexer: Record<string, unknown>) {
  const agent = {
    dependencyManager: { resolve: () => ({ findById: async () => record }) },
    didcomm: { credentials: { getFormatData: async () => ({ credential: { jsonld: {} } }) } },
  } as never
  const defaults = {
    getParticipantSession: async () => ({ session_records: [{ issuer_participant_id: 10 }] }),
    getParticipant: async () => activeIssuer,
    getCredentialSchema: async () => ({ id: 5, digest_algorithm: 'sha384' }),
    getDigest: async () => ({ digest: 'anchored' }),
  }
  return new VtFlowOrchestrator(agent, {
    indexer: { ...defaults, ...indexer } as never,
  }).verifyOfferedCredential('rec-1')
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
  const holder = { id: 5, did: 'did:web:agent', role: 1, validatorParticipantId: 9 }
  const validator = { id: 9, did: 'did:web:validator' }

  function makeAgent(previousConnection: unknown) {
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
    }
    const agent = {
      did: 'did:web:agent',
      label: 'Agent',
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      veranaChain: { getParticipant: vi.fn(async (id: number) => (id === 5 ? holder : validator)) },
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
    const { agent, vtFlowApi } = makeAgent({ id: 'conn-old', isReady: true })

    await new VtFlowOrchestrator(agent as never).startOnboardingProcess({ applicantParticipantId: 5 })

    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
    expect(vtFlowApi.sendOnboardingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-old', participantSessionId: 'sess-old' }),
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

  it('does not resend while a flow is still in progress', async () => {
    const { agent, vtFlowApi } = makeAgent(null)
    const inFlight = {
      id: 'rec-1',
      participantSessionId: 'sess-old',
      connectionId: 'conn-old',
      state: 'CRED_OFFERED',
      createdAt: new Date(0),
    }
    vtFlowApi.findAllByQuery.mockResolvedValue([inFlight])

    const result = await new VtFlowOrchestrator(agent as never).startOnboardingProcess({
      applicantParticipantId: 5,
    })

    expect(result).toBe(inFlight)
    expect(vtFlowApi.sendOnboardingRequest).not.toHaveBeenCalled()
    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
  })
})

describe('VtFlowOrchestrator onboarding validation', () => {
  const validatorRecord = {
    id: 'rec-v',
    role: VtFlowRole.Validator,
    variant: 'onboarding-process',
    state: 'AWAITING_OR',
    participantId: '94',
    claims: {},
  }

  function makeAgent(role: number) {
    const vtFlowApi = {
      findById: vi.fn(async () => validatorRecord),
      acceptOnboardingRequest: vi.fn(async () => validatorRecord),
      markValidated: vi.fn(async () => ({ ...validatorRecord, state: 'VALIDATED' })),
      markCompleted: vi.fn(async () => ({ ...validatorRecord, state: 'COMPLETED' })),
      offerCredentialForSession: vi.fn(async () => ({
        record: { ...validatorRecord, state: 'CRED_OFFERED' },
      })),
    }
    const agent = {
      did: 'did:web:validator',
      config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      dependencyManager: { resolve: () => vtFlowApi },
      veranaChain: {
        getParticipant: vi.fn(async () => ({
          id: 94,
          role,
          did: 'did:web:applicant',
          corporation: 'verana1corp',
          validatorParticipantId: 93,
        })),
        setParticipantOPToValidated: vi.fn(async () => undefined),
      },
    }
    return { agent, vtFlowApi }
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

    const { participant } = await new VtFlowOrchestrator(agent as never).validateOnboardingProcess({
      vtFlowRecordId: 'rec-v',
    })

    expect(participant.role).toBe(6)
  })

  it('offerOnboardingCredential offers against the validator participant', async () => {
    const { agent, vtFlowApi } = makeAgent(6) // HOLDER
    const orchestrator = new VtFlowOrchestrator(agent as never)
    // buildCredential needs an indexer and a schema; assert the wiring, not the credential body.
    ;(orchestrator as unknown as { buildCredential: unknown }).buildCredential = vi.fn(async () => ({
      id: 'urn:cred',
    }))

    const offered = await orchestrator.offerOnboardingCredential({
      vtFlowRecordId: 'rec-v',
      credentialSchemaId: '22',
    })

    expect(vtFlowApi.offerCredentialForSession).toHaveBeenCalledWith(
      expect.objectContaining({ vtFlowRecordId: 'rec-v', issuerParticipantId: 93 }),
    )
    expect(offered.state).toBe('CRED_OFFERED')
  })

  it('completeOnboardingProcess closes a flow that carries no credential', async () => {
    const { agent, vtFlowApi } = makeAgent(1) // ISSUER

    const completed = await new VtFlowOrchestrator(agent as never).completeOnboardingProcess('rec-v')

    expect(vtFlowApi.markCompleted).toHaveBeenCalledWith('rec-v')
    expect(completed.state).toBe('COMPLETED')
  })
})
