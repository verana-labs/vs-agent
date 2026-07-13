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
    getDigest: async () => ({ digest: 'sha384-anchored' }),
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
      didcomm: {
        connections: {
          findById: vi.fn().mockResolvedValue(previousConnection),
          returnWhenIsConnected: vi.fn().mockResolvedValue({ id: 'conn-new' }),
        },
        oob: {
          receiveImplicitInvitation: vi.fn().mockResolvedValue({ connectionRecord: { id: 'conn-new' } }),
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
