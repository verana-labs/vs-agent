import { utils } from '@credo-ts/core'
import { describe, expect, it, vi } from 'vitest'

import { VtFlowRole, VtFlowState, VtFlowVariant } from '../src'
import { OnboardingRequestMessage } from '../src/messages'
import { VtFlowRecord } from '../src/repository'
import { VtFlowService } from '../src/services/VtFlowService'

function makeRecord(overrides: Partial<ConstructorParameters<typeof VtFlowRecord>[0]> = {}) {
  return new VtFlowRecord({
    threadId: utils.uuid(),
    participantSessionId: 'sess-1',
    connectionId: 'conn-old',
    role: VtFlowRole.Applicant,
    state: VtFlowState.Completed,
    variant: VtFlowVariant.OnboardingProcess,
    agentParticipantId: '0',
    walletAgentParticipantId: '0',
    participantId: '42',
    ...overrides,
  })
}

function makeService(existing: VtFlowRecord | null, previousConnection: unknown = null) {
  const repository = {
    findByParticipantSessionId: vi.fn().mockResolvedValue(existing),
    save: vi.fn(),
    update: vi.fn(),
  }
  const eventEmitter = { emit: vi.fn() }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const config = { assertVerifiableService: undefined }
  const connectionRepository = { findById: vi.fn().mockResolvedValue(previousConnection) }
  const agentContext = { dependencyManager: { resolve: () => connectionRepository } }
  const service = new VtFlowService(
    repository as never,
    eventEmitter as never,
    logger as never,
    config as never,
  )
  return { service, repository, agentContext }
}

function makeMessageContext(agentContext: unknown, theirDid = 'did:web:agent-peer') {
  const message = new OnboardingRequestMessage({
    participantId: '42',
    participantSessionId: 'sess-1',
    agentParticipantId: '0',
    walletAgentParticipantId: '0',
  })
  message.setThread({ threadId: message.id })
  return {
    message,
    agentContext,
    assertReadyConnection: () => ({ id: 'conn-new', theirDid }),
  }
}

const applicantParams = {
  connectionId: 'conn-new',
  participantSessionId: 'sess-1',
  participantId: '42',
  agentParticipantId: '0',
  walletAgentParticipantId: '0',
}

describe('VtFlowService re-attach on same participant_session_id', () => {
  it('applicant renewal re-attaches the finished flow and re-runs it', async () => {
    const existing = makeRecord()
    const { service, repository } = makeService(existing)

    const { record } = await service.createOnboardingProcessRecord({} as never, applicantParams)

    expect(record).toBe(existing)
    expect(record.state).toBe(VtFlowState.OrSent)
    expect(record.connectionId).toBe('conn-new')
    expect(repository.update).toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('applicant resend against a flow that is still running is rejected', async () => {
    const existing = makeRecord({ state: VtFlowState.CredOffered })
    const { service, repository } = makeService(existing)

    await expect(service.createOnboardingProcessRecord({} as never, applicantParams)).rejects.toThrow(
      /already belongs to a flow in state/,
    )
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('validator receiving a renewal OR re-runs the finished flow instead of creating a new record', async () => {
    const existing = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.CredRevoked })
    const { service, repository, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })

    const record = await service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never)

    expect(record).toBe(existing)
    expect(record.state).toBe(VtFlowState.AwaitingOr)
    expect(record.connectionId).toBe('conn-new')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('validator rejects a session id colliding with a terminated flow', async () => {
    const existing = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.TerminatedByValidator })
    const { service, agentContext } = makeService(existing)

    await expect(
      service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never),
    ).rejects.toThrow(/collides with a terminated flow/)
  })

  it('validator rejects a re-attach from a different peer', async () => {
    const existing = makeRecord({ role: VtFlowRole.Validator })
    const { service, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })

    await expect(
      service.processReceiveOnboardingRequest(makeMessageContext(agentContext, 'did:web:attacker') as never),
    ).rejects.toThrow(/peer does not match/)
  })
})
