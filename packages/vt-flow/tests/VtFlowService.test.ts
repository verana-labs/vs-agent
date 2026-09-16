import { utils } from '@credo-ts/core'
import { describe, expect, it, vi } from 'vitest'

import { VtCredentialState, VtFlowRole, VtFlowState, VtFlowVariant } from '../src'
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
    getById: vi.fn().mockResolvedValue(existing),
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
    assertReadyConnection: () => ({ id: 'conn-new', theirDid, previousTheirDids: [] }),
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

  it('validator re-attaches a running flow to the new connection and keeps its state', async () => {
    const existing = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating })
    const { service, repository, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })

    const record = await service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never)

    expect(record).toBe(existing)
    expect(record.state).toBe(VtFlowState.Validating)
    expect(record.connectionId).toBe('conn-new')
    expect(repository.update).toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('validator keeps its edited claims when the applicant resends the same thread', async () => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.Validating,
      claims: { edited: true },
    })
    const { service, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const context = makeMessageContext(agentContext)
    context.message.setThread({ threadId: existing.threadId })
    context.message.claims = { name: 'Acme' }

    const record = await service.processReceiveOnboardingRequest(context as never)

    expect(record.claims).toEqual({ edited: true })
    expect(record.threadId).toBe(existing.threadId)
    expect(record.connectionId).toBe('conn-new')
  })

  it('validator takes the claims of a renewal, which opens a new thread', async () => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.Completed,
      claims: { edited: true },
    })
    const { service, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const context = makeMessageContext(agentContext)
    context.message.claims = { name: 'Acme' }

    const record = await service.processReceiveOnboardingRequest(context as never)

    expect(record.claims).toEqual({ name: 'Acme' })
    expect(record.threadId).toBe(context.message.threadId)
  })

  it('validator rejects a re-attach whose participant_id does not match the session', async () => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.Validating,
      participantId: '43',
    })
    const { service, repository, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })

    await expect(
      service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never),
    ).rejects.toThrow(/participant_id '42' does not match/)
    expect(repository.update).not.toHaveBeenCalled()
  })
})

describe('VtFlowService.reattachOnboardingProcessRecord', () => {
  it.each([
    VtFlowState.OrSent,
    VtFlowState.OobPending,
    VtFlowState.Validating,
    VtFlowState.CredOffered,
  ])('rebuilds the original request of a %s flow and moves only the connection', async state => {
    const existing = makeRecord({ state, claims: { name: 'Acme' } })
    const { service, repository } = makeService(existing)

    const { message, record } = await service.reattachOnboardingProcessRecord({} as never, {
      vtFlowRecordId: existing.id,
      connectionId: 'conn-new',
    })

    expect(message.id).not.toBe(existing.threadId)
    expect(message.threadId).toBe(existing.threadId)
    expect(message.participantSessionId).toBe('sess-1')
    expect(message.participantId).toBe('42')
    expect(message.claims).toEqual({ name: 'Acme' })
    expect(record.connectionId).toBe('conn-new')
    expect(record.state).toBe(state)
    expect(repository.update).toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it.each([
    VtFlowState.Completed,
    VtFlowState.CredRevoked,
    VtFlowState.TerminatedByValidator,
  ])('refuses a %s flow', async state => {
    const existing = makeRecord({ state })
    const { service, repository } = makeService(existing)

    await expect(
      service.reattachOnboardingProcessRecord({} as never, {
        vtFlowRecordId: existing.id,
        connectionId: 'c',
      }),
    ).rejects.toThrow(/cannot be re-attached/)
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('refuses a direct issuance record', async () => {
    const existing = makeRecord({
      variant: VtFlowVariant.DirectIssuance,
      state: VtFlowState.IrSent,
      participantId: undefined,
      schemaId: '5',
    })
    const { service } = makeService(existing)

    await expect(
      service.reattachOnboardingProcessRecord({} as never, {
        vtFlowRecordId: existing.id,
        connectionId: 'c',
      }),
    ).rejects.toThrow(/variant/)
  })
})

describe('VtFlowService.notifyCredentialStateChange', () => {
  it('allows re-notifying a revocation from CRED_REVOKED', async () => {
    const revoked = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.CredRevoked })
    const { service } = makeService(revoked)

    const { record } = await service.notifyCredentialStateChange({} as never, revoked.id, {
      state: VtCredentialState.Revoked,
      subprotocolThid: 'sub-1',
    })
    expect(record.state).toBe(VtFlowState.CredRevoked)
  })
})

describe('VtFlowService.updateClaims', () => {
  it('replaces claims while validating and rejects other states', async () => {
    const validating = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating })
    const { service, repository } = makeService(validating)

    const updated = await service.updateClaims({} as never, validating.id, { name: 'Edited' })
    expect(updated.claims).toEqual({ name: 'Edited' })
    expect(repository.update).toHaveBeenCalled()

    const completed = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Completed })
    repository.getById.mockResolvedValue(completed)
    await expect(service.updateClaims({} as never, completed.id, {})).rejects.toThrow()
  })
})

function makeGatedService(config: Record<string, unknown>) {
  const repository = {
    findByParticipantSessionId: vi.fn().mockResolvedValue(null),
    save: vi.fn(),
    update: vi.fn(),
  }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = new VtFlowService(
    repository as never,
    { emit: vi.fn() } as never,
    logger as never,
    config as never,
  )
  return { service, repository, logger }
}

const readyConnection = { id: 'conn-new', theirDid: 'did:web:agent-peer', previousTheirDids: [] }

describe('VtFlowService VS-CONN-VS gate', () => {
  it.each([
    ['the invitation DID', { invitationDid: 'did:web:validator', previousTheirDids: ['did:web:other'] }],
    ['the DID the peer rotated away from', { previousTheirDids: ['did:web:validator'] }],
  ])('checks %s of a connection whose peer rotated to a did:peer', async (_label, anchor) => {
    const assertVerifiableService = vi.fn(
      async ({ peerDid }: { peerDid: string }) => peerDid === 'did:web:validator',
    )
    const { service } = makeGatedService({ assertVerifiableService })
    const connection = { id: 'conn-rotated', theirDid: 'did:peer:4zQmRotated', ...anchor }

    await expect(service.checkIsVerifiableService({} as never, connection as never)).resolves.toBeUndefined()
    expect(assertVerifiableService).toHaveBeenCalledWith(
      expect.objectContaining({ peerDid: 'did:web:validator' }),
    )
  })

  it('still rejects a did:peer that was never anything else', async () => {
    const { service } = makeGatedService({
      assertVerifiableService: async ({ peerDid }: { peerDid: string }) => peerDid === 'did:web:validator',
    })
    const connection = { id: 'conn-peer', theirDid: 'did:peer:4zQmOther', previousTheirDids: [] }

    await expect(service.checkIsVerifiableService({} as never, connection as never)).rejects.toThrow(
      /not-a-verifiable-service: peer 'did:peer:4zQmOther'/,
    )
  })

  it('rejects an unverifiable peer when no purpose is given', async () => {
    const checkEcsIssuanceExemption = vi.fn().mockResolvedValue(true)
    const { service } = makeGatedService({
      assertVerifiableService: async () => false,
      checkEcsIssuanceExemption,
    })

    await expect(service.checkIsVerifiableService({} as never, readyConnection as never)).rejects.toThrow(
      /not-a-verifiable-service/,
    )
    expect(checkEcsIssuanceExemption).not.toHaveBeenCalled()
  })

  it('admits an unverifiable peer whose onboarding request qualifies for the ECS issuance exemption', async () => {
    const checkEcsIssuanceExemption = vi.fn().mockResolvedValue(true)
    const { service } = makeGatedService({
      assertVerifiableService: async () => false,
      checkEcsIssuanceExemption,
    })

    await expect(
      service.checkIsVerifiableService({} as never, readyConnection as never, { participantId: '42' }),
    ).resolves.toBeUndefined()
    expect(checkEcsIssuanceExemption).toHaveBeenCalledWith(
      expect.objectContaining({ peerDid: 'did:web:agent-peer', purpose: { participantId: '42' } }),
    )
  })

  it('rejects an unverifiable peer the exemption does not cover', async () => {
    const { service } = makeGatedService({
      assertVerifiableService: async () => false,
      checkEcsIssuanceExemption: async () => false,
    })

    await expect(
      service.checkIsVerifiableService({} as never, readyConnection as never, { schemaId: '5' }),
    ).rejects.toThrow(/not-a-verifiable-service/)
  })

  it('keeps the resolution error in the rejection when the exemption does not apply', async () => {
    const { service } = makeGatedService({
      assertVerifiableService: async () => {
        throw new Error('did not resolve')
      },
      checkEcsIssuanceExemption: async () => false,
    })

    await expect(
      service.checkIsVerifiableService({} as never, readyConnection as never, { participantId: '42' }),
    ).rejects.toThrow(/did not resolve/)
  })

  it('swallows an exemption failure and rejects the peer', async () => {
    const { service, logger } = makeGatedService({
      assertVerifiableService: async () => false,
      checkEcsIssuanceExemption: async () => {
        throw new Error('indexer unreachable')
      },
    })

    await expect(
      service.checkIsVerifiableService({} as never, readyConnection as never, { participantId: '42' }),
    ).rejects.toThrow(/not-a-verifiable-service/)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('indexer unreachable'))
  })

  it('passes the onboarding request participant id to the exemption', async () => {
    const checkEcsIssuanceExemption = vi.fn().mockResolvedValue(true)
    const { service, repository } = makeGatedService({
      assertVerifiableService: async () => false,
      checkEcsIssuanceExemption,
    })

    await service.processReceiveOnboardingRequest(makeMessageContext({}) as never)

    expect(checkEcsIssuanceExemption).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: { participantId: '42' } }),
    )
    expect(repository.save).toHaveBeenCalled()
  })
})
