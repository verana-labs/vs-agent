import { EventEmitter, JsonTransformer, utils } from '@credo-ts/core'
import {
  DidCommCredentialExchangeRepository,
  DidCommCredentialState,
  WhoRetriesStatus,
} from '@credo-ts/didcomm'
import { describe, expect, it, vi } from 'vitest'

import {
  VtCredentialState,
  VtFlowApi,
  VtFlowEventTypes,
  VtFlowMessageType,
  VtFlowModule,
  VtFlowModuleConfig,
  VtFlowRole,
  VtFlowState,
  VtFlowSubmission,
  VtFlowTxReason,
  VtFlowTxStatus,
  VtFlowVariant,
} from '../src'
import { VtFlowErrorCode } from '../src/errors'
import { IssuanceRequestHandler, OnboardingRequestHandler } from '../src/handlers'
import {
  IssuanceRequestMessage,
  OnboardingRequestMessage,
  OobLinkMessage,
  VT_FLOW_PROBLEM_REPORT_TYPE,
  ValidatingMessage,
  VtFlowProblemReportMessage,
} from '../src/messages'
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
    applicantParticipantId: '42',
    ...overrides,
  })
}

function makeService(
  existing: VtFlowRecord | null,
  previousConnection: unknown = null,
  moduleConfig: Record<string, unknown> = {},
) {
  const repository = {
    findByParticipantSessionId: vi.fn().mockResolvedValue(existing),
    getById: vi.fn().mockResolvedValue(existing),
    findByThreadId: vi.fn().mockResolvedValue(existing),
    save: vi.fn(),
    update: vi.fn(),
  }
  const eventEmitter = { emit: vi.fn() }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const config = { assertVerifiableService: undefined, ...moduleConfig }
  const connectionRepository = { findById: vi.fn().mockResolvedValue(previousConnection) }
  const exchangeRepository = { findById: vi.fn().mockResolvedValue(null), update: vi.fn() }
  const agentContext = {
    dependencyManager: {
      resolve: (token: unknown) =>
        token === DidCommCredentialExchangeRepository ? exchangeRepository : connectionRepository,
    },
  }
  const service = new VtFlowService(
    repository as never,
    eventEmitter as never,
    logger as never,
    config as never,
  )
  return { service, repository, agentContext, exchangeRepository, eventEmitter }
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

function makeIssuanceContext(agentContext: unknown, schemaId = '5') {
  const message = new IssuanceRequestMessage({
    schemaId,
    participantSessionId: 'sess-1',
    agentParticipantId: '0',
    walletAgentParticipantId: '0',
  })
  message.setThread({ threadId: message.id })
  return {
    message,
    agentContext,
    assertReadyConnection: () => ({ id: 'conn-new', theirDid: 'did:web:agent-peer', previousTheirDids: [] }),
  }
}

function sentReport(outbound: { message: unknown } | undefined) {
  return JsonTransformer.toJSON(outbound?.message) as Record<string, any>
}

const applicantParams = {
  connectionId: 'conn-new',
  participantSessionId: 'sess-1',
  applicantParticipantId: '42',
  agentParticipantId: '0',
  walletAgentParticipantId: '0',
}

describe('VtFlowService inbound problem-report', () => {
  function makeReport(code: string, whoRetries?: string) {
    return JsonTransformer.fromJSON(
      {
        '@type': VT_FLOW_PROBLEM_REPORT_TYPE,
        '@id': utils.uuid(),
        '~thread': { thid: utils.uuid() },
        description: { code, en: 'because' },
        who_retries: whoRetries,
      },
      VtFlowProblemReportMessage,
    )
  }

  async function receive(
    code: string,
    role: VtFlowRole,
    options: { whoRetries?: string; state?: VtFlowState } = {},
  ) {
    const existing = makeRecord({ role, state: options.state ?? VtFlowState.Validating })
    const repository = {
      findByThreadId: vi.fn().mockResolvedValue(existing),
      update: vi.fn(),
    }
    const service = new VtFlowService(
      repository as never,
      { emit: vi.fn() } as never,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      {} as never,
    )
    const record = await service.processReceiveProblemReport({
      message: makeReport(code, options.whoRetries),
      agentContext: {},
    } as never)
    return record as VtFlowRecord
  }

  it('terminates the applicant on a refused validation and records the message', async () => {
    const record = await receive(VtFlowErrorCode.ValidationRefused, VtFlowRole.Applicant)

    expect(record.state).toBe(VtFlowState.TerminatedByValidator)
    expect(record.messages).toEqual([
      expect.objectContaining({ type: VtFlowMessageType.ProblemReport, text: 'because' }),
    ])
  })

  it('resolves session-terminated from the role of the sender', async () => {
    await expect(receive(VtFlowErrorCode.SessionTerminated, VtFlowRole.Applicant)).resolves.toMatchObject({
      state: VtFlowState.TerminatedByValidator,
    })
    await expect(receive(VtFlowErrorCode.SessionTerminated, VtFlowRole.Validator)).resolves.toMatchObject({
      state: VtFlowState.TerminatedByApplicant,
      messages: undefined,
      errorMessage: 'because',
    })
  })

  it('stays on validation-failed only when who_retries is you', async () => {
    await expect(
      receive(VtFlowErrorCode.ValidationFailed, VtFlowRole.Applicant, { whoRetries: WhoRetriesStatus.You }),
    ).resolves.toMatchObject({ state: VtFlowState.Validating })
    await expect(
      receive(VtFlowErrorCode.ValidationFailed, VtFlowRole.Applicant, { whoRetries: WhoRetriesStatus.None }),
    ).resolves.toMatchObject({ state: VtFlowState.Error })
  })

  it('falls back to the registry who_retries when the wire carries none', async () => {
    await expect(receive(VtFlowErrorCode.ValidationFailed, VtFlowRole.Applicant)).resolves.toMatchObject({
      state: VtFlowState.Validating,
    })
  })

  it('moves to ERROR on internal-error only when it is fatal', async () => {
    await expect(
      receive(VtFlowErrorCode.InternalError, VtFlowRole.Applicant, { whoRetries: WhoRetriesStatus.You }),
    ).resolves.toMatchObject({ state: VtFlowState.Validating })
    await expect(
      receive(VtFlowErrorCode.InternalError, VtFlowRole.Applicant, { whoRetries: WhoRetriesStatus.None }),
    ).resolves.toMatchObject({ state: VtFlowState.Error })
    await expect(receive(VtFlowErrorCode.InternalError, VtFlowRole.Applicant)).resolves.toMatchObject({
      state: VtFlowState.Error,
    })
  })

  it('reads the lower case who_retries of the wire', async () => {
    await expect(
      receive(VtFlowErrorCode.ValidationFailed, VtFlowRole.Applicant, { whoRetries: 'you' }),
    ).resolves.toMatchObject({ state: VtFlowState.Validating })
    await expect(
      receive(VtFlowErrorCode.InternalError, VtFlowRole.Applicant, { whoRetries: 'none' }),
    ).resolves.toMatchObject({ state: VtFlowState.Error })
  })

  it('leaves a flow in a terminal state untouched', async () => {
    const record = await receive(VtFlowErrorCode.ValidationRefused, VtFlowRole.Applicant, {
      state: VtFlowState.TerminatedByApplicant,
    })

    expect(record.state).toBe(VtFlowState.TerminatedByApplicant)
    expect(record.messages).toBeUndefined()
    expect(record.errorMessage).toBeUndefined()
  })

  it('leaves the flow where it is on a retryable code', async () => {
    const record = await receive(VtFlowErrorCode.InvalidClaims, VtFlowRole.Applicant)

    expect(record.state).toBe(VtFlowState.Validating)
    expect(record.messages).toHaveLength(1)
    expect(record.errorMessage).toBeUndefined()
  })

  it('moves an unknown code nowhere and still records it', async () => {
    const record = await receive('vt-flow.not-a-real-code', VtFlowRole.Applicant)

    expect(record.state).toBe(VtFlowState.Validating)
    expect(record.messages).toHaveLength(1)
    expect(record.errorMessage).toBeUndefined()
  })
})

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

  it('applicant renewal re-enters a flow left in VALIDATED only for a role other than HOLDER', async () => {
    const issuer = makeService(makeRecord({ state: VtFlowState.Validated, applicantParticipantRole: 1 }))
    const { record } = await issuer.service.createOnboardingProcessRecord({} as never, applicantParams)
    expect(record.state).toBe(VtFlowState.OrSent)

    const holder = makeService(makeRecord({ state: VtFlowState.Validated, applicantParticipantRole: 6 }))
    await expect(holder.service.createOnboardingProcessRecord({} as never, applicantParams)).rejects.toThrow(
      /already belongs to a flow in state VALIDATED/,
    )
  })

  it('validator re-enters a flow left in VALIDATED on a renewal only for a role other than HOLDER', async () => {
    const peer = { id: 'conn-old', theirDid: 'did:web:agent-peer' }
    const issuer = makeService(
      makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validated, applicantParticipantRole: 1 }),
      peer,
    )
    const renewed = await issuer.service.processReceiveOnboardingRequest(
      makeMessageContext(issuer.agentContext) as never,
    )
    expect(renewed.state).toBe(VtFlowState.AwaitingOr)

    const holder = makeService(
      makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validated, applicantParticipantRole: 6 }),
      peer,
    )
    const kept = await holder.service.processReceiveOnboardingRequest(
      makeMessageContext(holder.agentContext) as never,
    )
    expect(kept.state).toBe(VtFlowState.Validated)
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

  it.each([
    [VtFlowState.Completed, 6],
    [VtFlowState.Validated, 1],
    [VtFlowState.CredRevoked, 6],
  ])('validator renewal from %s drops the validation and issuance of the previous round', async (state, role) => {
    const messages = [{ type: VtFlowMessageType.Validating, text: 'ok', at: '2026-01-01T00:00:00.000Z' }]
    const tx = { hash: 'AA', status: VtFlowTxStatus.Succeeded }
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state,
      applicantParticipantRole: role,
      claims: { name: 'Acme' },
      messages,
      validation: { decidedAt: '2026-01-01T00:00:00.000Z', submission: VtFlowSubmission.Agent, tx },
      issuance: { tx },
    })
    const { service, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })

    const record = await service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never)

    expect(record.state).toBe(VtFlowState.AwaitingOr)
    expect(record.validation).toBeUndefined()
    expect(record.issuance).toBeUndefined()
    expect(record.messages).toEqual(messages)
    expect(record.claims).toEqual({ name: 'Acme' })
  })

  it('validator keeps a flow in VALIDATED when the applicant resends its request', async () => {
    const existing = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validated })
    const { service, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const context = makeMessageContext(agentContext)
    context.message.setThread({ threadId: existing.threadId })

    const record = await service.processReceiveOnboardingRequest(context as never)

    expect(record.state).toBe(VtFlowState.Validated)
  })

  it('validator signals issuance only when the applicant re-attaches a VALIDATED flow whose connection a reject ended', async () => {
    const peer = { id: 'conn-old', theirDid: 'did:web:agent-peer' }
    const waiting = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.Validated,
      applicantParticipantRole: 6,
    })
    waiting.connectionTerminated = true
    const reconnection = makeService(waiting, peer)
    const context = makeMessageContext(reconnection.agentContext)

    await reconnection.service.processReceiveOnboardingRequest(context as never)

    expect(waiting.connectionTerminated).toBeUndefined()
    expect(reconnection.eventEmitter.emit).toHaveBeenCalledExactlyOnceWith(reconnection.agentContext, {
      type: VtFlowEventTypes.VtFlowStateChanged,
      payload: {
        vtFlowRecordId: waiting.id,
        threadId: context.message.threadId,
        participantSessionId: 'sess-1',
        state: VtFlowState.Validated,
        previousState: VtFlowState.Validated,
      },
    })

    const plain = makeService(
      makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validated, applicantParticipantRole: 6 }),
      peer,
    )
    await plain.service.processReceiveOnboardingRequest(makeMessageContext(plain.agentContext) as never)
    expect(plain.eventEmitter.emit).not.toHaveBeenCalled()
  })

  it('validator signals a request re-attached to a flow in AWAITING_OR, so its checks run again', async () => {
    const peer = { id: 'conn-old', theirDid: 'did:web:agent-peer' }
    const rejected = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingOr })
    const retry = makeService(rejected, peer)
    const context = makeMessageContext(retry.agentContext)
    context.message.claims = { name: 'Acme' }

    const record = await retry.service.processReceiveOnboardingRequest(context as never)

    expect(record).toMatchObject({ state: VtFlowState.AwaitingOr, claims: { name: 'Acme' } })
    expect(retry.eventEmitter.emit).toHaveBeenCalledExactlyOnceWith(retry.agentContext, {
      type: VtFlowEventTypes.VtFlowStateChanged,
      payload: {
        vtFlowRecordId: rejected.id,
        threadId: context.message.threadId,
        participantSessionId: 'sess-1',
        state: VtFlowState.AwaitingOr,
        previousState: VtFlowState.AwaitingOr,
      },
    })

    const running = makeService(
      makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating }),
      peer,
    )
    await running.service.processReceiveOnboardingRequest(makeMessageContext(running.agentContext) as never)
    expect(running.eventEmitter.emit).not.toHaveBeenCalled()
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
    expect(record.state).toBe(VtFlowState.Validating)
    expect(record.connectionId).toBe('conn-new')
  })

  it('validator rejects a re-attach whose participant_id does not match the session', async () => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.Validating,
      applicantParticipantId: '43',
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

  it('validator rejects an issuance re-attach whose schema_id does not match the session', async () => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.Validating,
      variant: VtFlowVariant.DirectIssuance,
      applicantParticipantId: undefined,
      schemaId: '5',
    })
    const { service, repository, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const message = new IssuanceRequestMessage({
      schemaId: '6',
      participantSessionId: 'sess-1',
      agentParticipantId: '0',
      walletAgentParticipantId: '0',
    })
    message.setThread({ threadId: message.id })
    const context = {
      message,
      agentContext,
      assertReadyConnection: () => ({
        id: 'conn-new',
        theirDid: 'did:web:agent-peer',
        previousTheirDids: [],
      }),
    }

    await expect(service.processReceiveIssuanceRequest(context as never)).rejects.toThrow(
      /schema_id '6' does not match/,
    )
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('validator rejects an issuance-request that reuses the session of an onboarding flow', async () => {
    const existing = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating, schemaId: '5' })
    const { service, repository, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const message = new IssuanceRequestMessage({
      schemaId: '5',
      participantSessionId: 'sess-1',
      agentParticipantId: '0',
      walletAgentParticipantId: '0',
    })
    message.setThread({ threadId: message.id })
    const context = {
      message,
      agentContext,
      assertReadyConnection: () => ({
        id: 'conn-new',
        theirDid: 'did:web:agent-peer',
        previousTheirDids: [],
      }),
    }

    await expect(service.processReceiveIssuanceRequest(context as never)).rejects.toThrow(
      /schema_id '5' does not match/,
    )
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('validator re-attach during the credential offer drops the exchange and steps back to Validated', async () => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.CredOffered,
      credentialExchangeRecordId: 'cred-ex-1',
      subprotocolThid: 'sub-1',
      issuance: {
        tx: { hash: 'CD34', submittedAt: new Date().toISOString(), status: VtFlowTxStatus.Submitted },
      },
    })
    const { service, agentContext, exchangeRepository } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const stale = { id: 'cred-ex-1', parentThreadId: existing.threadId }
    exchangeRepository.findById.mockResolvedValue(stale)

    const record = await service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never)

    expect(record.state).toBe(VtFlowState.Validated)
    expect(record.credentialExchangeRecordId).toBeUndefined()
    expect(record.subprotocolThid).toBeUndefined()
    expect(record.issuance).toBeUndefined()
    expect(record.connectionId).toBe('conn-new')
    expect(stale.parentThreadId).toBeUndefined()
    expect(exchangeRepository.update).toHaveBeenCalledWith(agentContext, stale)
  })
})

describe('vt-flow request refusals', () => {
  it.each([
    [
      'the session id of a terminated flow',
      { state: VtFlowState.TerminatedByValidator },
      'did:web:agent-peer',
    ],
    [
      'a participant_id that is not the one of the session',
      { applicantParticipantId: '43' },
      'did:web:agent-peer',
    ],
    ['the session id of another peer', {}, 'did:web:attacker'],
  ])('answer an onboarding-request with %s with a retryable problem-report', async (_label, overrides, theirDid) => {
    const existing = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating, ...overrides })
    const { service, repository, agentContext } = makeService(existing, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })
    const context = makeMessageContext(agentContext, theirDid)

    const report = sentReport(await new OnboardingRequestHandler(service).handle(context as never))

    expect(report).toMatchObject({
      description: { code: VtFlowErrorCode.InvalidParticipantSessionId },
      who_retries: 'you',
      impact: 'thread',
    })
    expect(report['~thread']).toEqual({ thid: context.message.threadId })
    expect(repository.update).not.toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it.each([
    ['the session id of a terminated flow', VtFlowState.TerminatedByValidator, '5'],
    ['the session id of another schema', VtFlowState.Validating, '6'],
  ])('answer an issuance-request with %s with a retryable problem-report', async (_label, state, schemaId) => {
    const existing = makeRecord({
      role: VtFlowRole.Validator,
      state,
      variant: VtFlowVariant.DirectIssuance,
      schemaId: '5',
    })
    const { service, repository, agentContext } = makeService(existing)
    const context = makeIssuanceContext(agentContext, schemaId)

    const report = sentReport(await new IssuanceRequestHandler(service).handle(context as never))

    expect(report).toMatchObject({
      description: { code: VtFlowErrorCode.InvalidParticipantSessionId },
      who_retries: 'you',
      impact: 'thread',
    })
    expect(report['~thread']).toEqual({ thid: context.message.threadId })
    expect(repository.update).not.toHaveBeenCalled()
  })
})

describe('VtFlowService.reattachOnboardingProcessRecord', () => {
  it('rebuilds the request of a running flow on the same thread and moves only the connection', async () => {
    const existing = makeRecord({ state: VtFlowState.OrSent, claims: { name: 'Acme' } })
    const { service, repository } = makeService(existing)

    const { message, record } = await service.reattachOnboardingProcessRecord({} as never, {
      vtFlowRecordId: existing.id,
      connectionId: 'conn-new',
    })

    expect(message.id).not.toBe(existing.threadId)
    expect(message.threadId).toBe(existing.threadId)
    expect(message.participantSessionId).toBe('sess-1')
    expect(message.claims).toEqual({ name: 'Acme' })
    expect(record.connectionId).toBe('conn-new')
    expect(record.state).toBe(VtFlowState.OrSent)
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('drops the exchange of a flow in CredOffered and steps back to Validating', async () => {
    const existing = makeRecord({
      state: VtFlowState.CredOffered,
      credentialExchangeRecordId: 'cred-ex-1',
      subprotocolThid: 'sub-1',
    })
    const { service, agentContext, exchangeRepository } = makeService(existing)
    const stale = { id: 'cred-ex-1', parentThreadId: existing.threadId }
    exchangeRepository.findById.mockResolvedValue(stale)

    const { record } = await service.reattachOnboardingProcessRecord(agentContext as never, {
      vtFlowRecordId: existing.id,
      connectionId: 'conn-new',
    })

    expect(record.state).toBe(VtFlowState.Validating)
    expect(stale.parentThreadId).toBeUndefined()
    expect(record.credentialExchangeRecordId).toBeUndefined()
    expect(record.subprotocolThid).toBeUndefined()
    expect(record.connectionId).toBe('conn-new')
  })

  it('refuses a finished flow', async () => {
    const existing = makeRecord({ state: VtFlowState.Completed })
    const { service, repository } = makeService(existing)

    await expect(
      service.reattachOnboardingProcessRecord({} as never, {
        vtFlowRecordId: existing.id,
        connectionId: 'c',
      }),
    ).rejects.toThrow(/cannot be re-attached/)
    expect(repository.update).not.toHaveBeenCalled()
  })
})

describe('VtFlowService.processReceiveValidating', () => {
  it.each([
    { state: VtFlowState.OrSent, messages: undefined },
    { state: VtFlowState.IrSent, messages: undefined },
    {
      state: VtFlowState.OobPending,
      messages: [{ type: VtFlowMessageType.Validating, at: expect.any(String) }],
    },
  ])('applicant moves from $state to VALIDATING and records a validating without comment from OOB_PENDING only', async ({
    state,
    messages,
  }) => {
    const existing = makeRecord({ state })
    const { service } = makeService(existing)

    const record = await service.processReceiveValidating({
      message: new ValidatingMessage({ threadId: existing.threadId }),
      agentContext: {},
      assertReadyConnection: () => undefined,
    } as never)

    expect(record.state).toBe(VtFlowState.Validating)
    expect(record.messages).toEqual(messages)
  })
})

describe('VtFlowService.processReceiveOobLink', () => {
  it('applicant refuses an oob-link once the flow is COMPLETED', async () => {
    const existing = makeRecord()
    const { service, repository } = makeService(existing)

    await expect(
      service.processReceiveOobLink({
        message: new OobLinkMessage({ threadId: existing.threadId, url: 'https://x', description: 'd' }),
        agentContext: {},
        assertReadyConnection: () => undefined,
      } as never),
    ).rejects.toThrow(/state 'COMPLETED'/)
    expect(repository.update).not.toHaveBeenCalled()
  })
})

describe('VtFlowService.sendOobLinkForSession', () => {
  it('refuses a request the validator has not accepted yet', async () => {
    const awaiting = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingOr })
    const { service } = makeService(awaiting)

    await expect(
      service.sendOobLinkForSession({} as never, awaiting.id, { url: 'https://x', description: 'd' }),
    ).rejects.toThrow(/Valid states: VALIDATING, OOB_PENDING\./)
  })
})

describe('VtFlowService.sendValidatingForSession', () => {
  it('moves OOB_PENDING to VALIDATING and refuses any other state', async () => {
    const pending = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.OobPending,
      oobLink: { url: 'https://x', description: 'd', at: new Date().toISOString() },
    })
    const { service } = makeService(pending)

    const { record, message } = await service.sendValidatingForSession({} as never, pending.id, {
      comment: 'Documents received',
    })
    expect(record.state).toBe(VtFlowState.Validating)
    expect(record.oobLink).toBeUndefined()
    expect(record.messages).toEqual([
      expect.objectContaining({ type: VtFlowMessageType.Validating, text: 'Documents received' }),
    ])
    expect(message.threadId).toBe(pending.threadId)

    await expect(service.sendValidatingForSession({} as never, pending.id)).rejects.toThrow(
      /state 'VALIDATING'/,
    )
  })

  it('records the validating it sends without a comment', async () => {
    const pending = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.OobPending })
    const { service } = makeService(pending)

    const { record } = await service.sendValidatingForSession({} as never, pending.id)

    expect(record.messages).toEqual([{ type: VtFlowMessageType.Validating, at: expect.any(String) }])
  })
})

describe('VtFlowService.terminateByValidator', () => {
  it('refuses a flow whose validation transaction is in flight and closes a COMPLETED one', async () => {
    const submitted = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.ValidationTxSubmitted })
    const { service, repository } = makeService(submitted)

    await expect(service.terminateByValidator({} as never, submitted.id)).rejects.toThrow(
      /state 'VALIDATION_TX_SUBMITTED'/,
    )
    expect(repository.update).not.toHaveBeenCalled()

    const completed = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Completed })
    repository.getById.mockResolvedValue(completed)
    const { record } = await service.terminateByValidator({} as never, completed.id)
    expect(record.state).toBe(VtFlowState.TerminatedByValidator)
  })

  it('records the problem-report it sends in messages[]', async () => {
    const validating = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating })
    const { service } = makeService(validating)

    const { record } = await service.terminateByValidator({} as never, validating.id, {
      code: VtFlowErrorCode.ValidationRefused,
      enDescription: 'Documents do not match',
    })

    expect(record.messages).toEqual([
      expect.objectContaining({ type: VtFlowMessageType.ProblemReport, text: 'Documents do not match' }),
    ])
  })

  it('keeps the connection terminated when a validation in flight lands, until the applicant re-attaches', async () => {
    const pending = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingValidationTx })
    const { service, agentContext } = makeService(pending, {
      id: 'conn-old',
      theirDid: 'did:web:agent-peer',
    })

    await service.terminateByValidator({} as never, pending.id)
    expect(pending.connectionTerminated).toBe(true)

    await service.recordValidation(
      {} as never,
      pending.id,
      { decidedAt: '2026-09-25T09:00:00Z', submission: VtFlowSubmission.Operator },
      VtFlowState.Validated,
    )
    expect(pending.state).toBe(VtFlowState.Validated)
    expect(pending.connectionTerminated).toBe(true)

    await service.processReceiveOnboardingRequest(makeMessageContext(agentContext) as never)
    expect(pending.connectionId).toBe('conn-new')
    expect(pending.connectionTerminated).toBeUndefined()
  })
})

describe('VtFlowService.acceptOnboardingRequest', () => {
  it('refuses a participant_id the checkParticipantId hook rejects and leaves the flow in AWAITING_OR', async () => {
    const awaiting = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingOr })
    const checkParticipantId = vi.fn().mockResolvedValue(false)
    const { service, repository, agentContext } = makeService(awaiting, null, { checkParticipantId })

    await expect(service.acceptOnboardingRequest(agentContext as never, awaiting.id)).rejects.toMatchObject({
      code: VtFlowErrorCode.InvalidParticipantId,
    })
    expect(checkParticipantId).toHaveBeenCalledWith({ agentContext, record: awaiting })
    expect(awaiting.state).toBe(VtFlowState.AwaitingOr)
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('moves to VALIDATING only when the flow is still AWAITING_OR once the check passes', async () => {
    const awaiting = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingOr })
    const { service, repository, agentContext } = makeService(awaiting, null, {
      checkParticipantId: vi.fn().mockResolvedValue(true),
    })
    repository.getById
      .mockResolvedValueOnce(awaiting)
      .mockResolvedValueOnce(
        makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.TerminatedByValidator }),
      )

    await expect(service.acceptOnboardingRequest(agentContext as never, awaiting.id)).rejects.toThrow(
      /TERMINATED_BY_VALIDATOR/,
    )
    expect(repository.update).not.toHaveBeenCalled()

    const { record } = await service.acceptOnboardingRequest(agentContext as never, awaiting.id)
    expect(record.state).toBe(VtFlowState.Validating)
  })

  it('neither moves the flow nor sends anything once the check settles the request on a VALIDATED entry', async () => {
    const awaiting = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingOr })
    const checkParticipantId = vi.fn(async () => {
      awaiting.state = VtFlowState.Validated
      return 'validated' as const
    })
    const { service, repository, agentContext, eventEmitter } = makeService(awaiting, null, {
      checkParticipantId,
    })
    const sendMessage = vi.fn()
    const api = new VtFlowApi(
      service,
      { sendMessage } as never,
      {} as never,
      agentContext as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(api.acceptOnboardingRequest(awaiting.id)).resolves.toMatchObject({
      state: VtFlowState.Validated,
    })
    expect(repository.update).not.toHaveBeenCalled()
    expect(eventEmitter.emit).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('VtFlowService.rejectRequest', () => {
  it.each([
    [VtFlowVariant.OnboardingProcess, VtFlowState.AwaitingOr],
    [VtFlowVariant.DirectIssuance, VtFlowState.AwaitingIr],
  ])('returns a %s validator to %s on a retryable code', async (variant, awaiting) => {
    const validating = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating, variant })
    const { service } = makeService(validating)

    const { record, problemReport } = await service.rejectRequest({} as never, validating.id, {
      code: VtFlowErrorCode.InvalidClaims,
    })

    expect(record.state).toBe(awaiting)
    expect(record.errorMessage).toBeUndefined()
    expect(record.messages).toEqual([
      expect.objectContaining({ type: VtFlowMessageType.ProblemReport, text: problemReport.description.en }),
    ])
  })

  it.each([
    [VtFlowRole.Validator, VtFlowErrorCode.NotAVerifiableService, VtFlowState.Error],
    [VtFlowRole.Validator, VtFlowErrorCode.ValidationRefused, VtFlowState.TerminatedByValidator],
    [VtFlowRole.Applicant, VtFlowErrorCode.SessionTerminated, VtFlowState.TerminatedByApplicant],
  ])('moves the %s sending %s to %s', async (role, code, state) => {
    const validating = makeRecord({ role, state: VtFlowState.Validating })
    const { service } = makeService(validating)

    const { record } = await service.rejectRequest({} as never, validating.id, { code })

    expect(record.state).toBe(state)
    expect(record.errorMessage).toBe(code)
  })

  it('refuses a flow that has ended', async () => {
    const ended = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.TerminatedByApplicant })
    const { service, repository } = makeService(ended)

    await expect(
      service.rejectRequest({} as never, ended.id, { code: VtFlowErrorCode.InvalidClaims }),
    ).rejects.toThrow(/cannot be rejected/)
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('refuses a retryable code once the validator has finished the flow', async () => {
    const completed = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Completed })
    const { service, repository } = makeService(completed)

    await expect(
      service.rejectRequest({} as never, completed.id, { code: VtFlowErrorCode.InvalidClaims }),
    ).rejects.toThrow(/state 'COMPLETED'/)
    expect(repository.update).not.toHaveBeenCalled()
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

describe('VtFlowService.sendOobLinkForSession', () => {
  it('stores a resent link in OOB_PENDING without a state event', async () => {
    const pending = makeRecord({
      role: VtFlowRole.Validator,
      state: VtFlowState.OobPending,
      oobLink: { url: 'https://a.example', description: 'A', at: '2026-01-01T00:00:00.000Z' },
      messages: [
        {
          type: VtFlowMessageType.OobLink,
          text: 'A',
          at: '2026-01-01T00:00:00.000Z',
          url: 'https://a.example',
        },
      ],
    })
    const { service, repository, eventEmitter } = makeService(pending)

    await service.sendOobLinkForSession({} as never, pending.id, {
      url: 'https://b.example',
      description: 'B',
    })

    expect(repository.update).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        state: VtFlowState.OobPending,
        oobLink: expect.objectContaining({ url: 'https://b.example', description: 'B' }),
        messages: [
          expect.objectContaining({ url: 'https://a.example' }),
          expect.objectContaining({ type: VtFlowMessageType.OobLink, text: 'B', url: 'https://b.example' }),
        ],
      }),
    )
    expect(eventEmitter.emit).not.toHaveBeenCalled()
  })
})

describe('VtFlowService issuance after validation', () => {
  it('moves VALIDATED to VALIDATED_PENDING_CLAIMS and refuses any other state', async () => {
    const validated = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validated })
    const { service } = makeService(validated)

    const record = await service.markPendingClaims({} as never, validated.id)
    expect(record.state).toBe(VtFlowState.ValidatedPendingClaims)

    await expect(service.markPendingClaims({} as never, validated.id)).rejects.toThrow(
      /state 'VALIDATED_PENDING_CLAIMS'/,
    )
  })

  it('records the anchoring outcome and keeps the flow in CRED_OFFERED', async () => {
    const offered = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.CredOffered })
    const { service, repository } = makeService(offered)
    const issuance = { tx: { status: VtFlowTxStatus.Failed, reason: VtFlowTxReason.TxFailed, error: 'out' } }

    await service.recordIssuance({} as never, offered.id, issuance)

    expect(repository.update).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ state: VtFlowState.CredOffered, issuance }),
    )
  })

  it('passes an onboarding applicant through VALIDATED when the offer beats the chain notification', async () => {
    const onboarding = makeRecord({ state: VtFlowState.Validating })
    const direct = makeRecord({ state: VtFlowState.Validating, variant: VtFlowVariant.DirectIssuance })
    const transitions: VtFlowState[][] = []
    for (const record of [onboarding, direct]) {
      const { service, agentContext, eventEmitter } = makeService(record)
      await service.onSubprotocolStateChanged(agentContext as never, record, {
        id: 'cx-1',
        state: 'offer-received',
      } as never)
      transitions.push(eventEmitter.emit.mock.calls.map(([, { payload }]) => payload.state))
    }

    expect(transitions).toEqual([[VtFlowState.Validated, VtFlowState.CredOffered], [VtFlowState.CredOffered]])
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

  it('replaces claims while the validation transaction is pending, per [VSA-ADM-VT-FL-EDIT]', async () => {
    const awaitingTx = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingValidationTx })
    const { service } = makeService(awaitingTx)

    const updated = await service.updateClaims({} as never, awaitingTx.id, { name: 'Edited' })
    expect(updated.claims).toEqual({ name: 'Edited' })
    expect(updated.state).toBe(VtFlowState.AwaitingValidationTx)
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

  it.each([
    ['onboarding-request', OnboardingRequestHandler, makeMessageContext, VtFlowVariant.OnboardingProcess],
    ['issuance-request', IssuanceRequestHandler, makeIssuanceContext, VtFlowVariant.DirectIssuance],
  ])('answers an %s from an unverifiable peer with a fatal problem-report and a flow in ERROR', async (_label, Handler, makeContext, variant) => {
    const { service, repository } = makeGatedService({ assertVerifiableService: async () => false })
    const context = makeContext({})

    const report = sentReport(await new Handler(service).handle(context as never))

    expect(report).toMatchObject({
      description: { code: VtFlowErrorCode.NotAVerifiableService },
      who_retries: 'none',
      impact: 'connection',
    })
    expect(report['~thread']).toEqual({ thid: context.message.threadId })
    expect(repository.save).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        state: VtFlowState.Error,
        variant,
        threadId: context.message.threadId,
        errorMessage: expect.stringMatching(/not-a-verifiable-service/),
        messages: [
          expect.objectContaining({ type: VtFlowMessageType.ProblemReport, text: report.description.en }),
        ],
      }),
    )
  })

  it('ends the running flow of an unverifiable peer in ERROR and leaves the flow of another peer alone', async () => {
    const previous = { id: 'conn-old', theirDid: 'did:web:agent-peer' }
    const rejectAll = { assertVerifiableService: async () => false }

    const own = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating })
    const same = makeService(own, previous, rejectAll)
    await new OnboardingRequestHandler(same.service).handle(makeMessageContext(same.agentContext) as never)
    expect(own.state).toBe(VtFlowState.Error)

    const other = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validating })
    const foreign = makeService(other, previous, rejectAll)
    const report = sentReport(
      await new OnboardingRequestHandler(foreign.service).handle(
        makeMessageContext(foreign.agentContext, 'did:web:attacker') as never,
      ),
    )
    expect(report.description.code).toBe(VtFlowErrorCode.NotAVerifiableService)
    expect(other.state).toBe(VtFlowState.Validating)
    expect(foreign.repository.update).not.toHaveBeenCalled()
    expect(foreign.repository.save).not.toHaveBeenCalled()
  })

  it('leaves an ended flow of an unverifiable peer as it is', async () => {
    const ended = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.TerminatedByValidator })
    const { service, repository, agentContext } = makeService(ended, null, {
      assertVerifiableService: async () => false,
    })

    const report = sentReport(
      await new OnboardingRequestHandler(service).handle(makeMessageContext(agentContext) as never),
    )

    expect(report.description.code).toBe(VtFlowErrorCode.NotAVerifiableService)
    expect(ended.state).toBe(VtFlowState.TerminatedByValidator)
    expect(repository.update).not.toHaveBeenCalled()
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

describe('VtFlowService.onSubprotocolStateChanged', () => {
  it('moves the flow to ERROR when the applicant declines the offer', async () => {
    const record = makeRecord({ state: VtFlowState.CredOffered, credentialExchangeRecordId: 'cx-1' })
    const { service, agentContext } = makeService(record)

    await service.onSubprotocolStateChanged(agentContext as never, record, {
      id: 'cx-1',
      state: DidCommCredentialState.Declined,
    } as never)

    expect(record.state).toBe(VtFlowState.Error)
  })
})

describe('VtFlowModule state listeners', () => {
  it('log a record read that fails after shutdown instead of rejecting', async () => {
    const listeners: Array<(event: unknown) => Promise<void>> = []
    const logger = { debug: vi.fn(), error: vi.fn() }
    const service = new VtFlowService(
      { findById: vi.fn().mockRejectedValue(new Error('Invalid store handle')) } as never,
      {} as never,
      logger as never,
      new VtFlowModuleConfig({ onCompleted: vi.fn(), onCredentialRevoked: vi.fn() }),
    )
    const eventEmitter = {
      on: (type: string, listener: (event: unknown) => Promise<void>) => {
        if (type === VtFlowEventTypes.VtFlowStateChanged) listeners.push(listener)
      },
    }
    const registry = { registerMessageHandlers: vi.fn(), register: vi.fn() }
    const agentContext = {
      dependencyManager: {
        resolve: (token: unknown) =>
          token === VtFlowService ? service : token === EventEmitter ? eventEmitter : registry,
      },
    }
    await new VtFlowModule().initialize(agentContext as never)

    const events = [VtFlowState.Completed, VtFlowState.CredRevoked].map(state => ({
      payload: { vtFlowRecordId: 'flow-1', state, previousState: VtFlowState.Validating },
    }))
    await Promise.all(events.flatMap(event => listeners.map(listener => listener(event))))

    expect(listeners).toHaveLength(3)
    expect(logger.error).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['re-entered a VALIDATED flow on a renewal', VtFlowState.Validated, 1],
    ['re-attached to a flow in AWAITING_OR', VtFlowState.AwaitingOr, 1],
    ['rejected with a retryable code', VtFlowState.Validating, 0],
  ])('auto-accept an onboarding-request that %s', async (_label, previousState, accepts) => {
    const listeners: Array<(event: unknown) => Promise<void>> = []
    const record = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.AwaitingOr })
    const service = new VtFlowService(
      { findById: vi.fn().mockResolvedValue(record) } as never,
      {} as never,
      { debug: vi.fn(), error: vi.fn() } as never,
      new VtFlowModuleConfig({ autoAcceptOnboardingRequest: true }),
    )
    const vtFlowApi = { acceptOnboardingRequest: vi.fn() }
    const eventEmitter = {
      on: (type: string, listener: (event: unknown) => Promise<void>) => {
        if (type === VtFlowEventTypes.VtFlowStateChanged) listeners.push(listener)
      },
    }
    const registry = { registerMessageHandlers: vi.fn(), register: vi.fn() }
    const agentContext = {
      dependencyManager: {
        resolve: (token: unknown) =>
          token === VtFlowService
            ? service
            : token === EventEmitter
              ? eventEmitter
              : token === VtFlowApi
                ? vtFlowApi
                : registry,
      },
    }
    await new VtFlowModule().initialize(agentContext as never)

    const event = { payload: { vtFlowRecordId: record.id, state: VtFlowState.AwaitingOr, previousState } }
    await Promise.all(listeners.map(listener => listener(event)))

    expect(vtFlowApi.acceptOnboardingRequest).toHaveBeenCalledTimes(accepts)
    if (accepts) expect(vtFlowApi.acceptOnboardingRequest).toHaveBeenCalledWith(record.id)
  })

  it('auto-accepts an offer through the vt-flow offer check', async () => {
    const listeners: Array<(event: unknown) => Promise<void>> = []
    const record = makeRecord({ state: VtFlowState.CredOffered, credentialExchangeRecordId: 'cx-1' })
    const service = new VtFlowService(
      { findById: vi.fn().mockResolvedValue(record) } as never,
      {} as never,
      { debug: vi.fn(), error: vi.fn() } as never,
      new VtFlowModuleConfig({ autoAcceptCredentialOffer: true }),
    )
    const vtFlowApi = { acceptCredentialOffer: vi.fn(async () => record) }
    const eventEmitter = {
      on: (type: string, listener: (event: unknown) => Promise<void>) => {
        if (type === VtFlowEventTypes.VtFlowStateChanged) listeners.push(listener)
      },
    }
    const registry = { registerMessageHandlers: vi.fn(), register: vi.fn() }
    const dependencies = new Map<unknown, unknown>([
      [VtFlowService, service],
      [EventEmitter, eventEmitter],
      [VtFlowApi, vtFlowApi],
    ])
    const agentContext = {
      dependencyManager: { resolve: (token: unknown) => dependencies.get(token) ?? registry },
    }
    await new VtFlowModule().initialize(agentContext as never)

    const event = {
      payload: {
        vtFlowRecordId: record.id,
        state: VtFlowState.CredOffered,
        previousState: VtFlowState.Validated,
      },
    }
    await Promise.all(listeners.map(listener => listener(event)))

    expect(vtFlowApi.acceptCredentialOffer).toHaveBeenCalledWith(record.id)
  })

  it('call onReconnected when the applicant re-attaches a VALIDATED flow, and not on the move to VALIDATED', async () => {
    const listeners: Array<(event: unknown) => Promise<void>> = []
    const record = makeRecord({ role: VtFlowRole.Validator, state: VtFlowState.Validated })
    const onReconnected = vi.fn()
    const service = new VtFlowService(
      { findById: vi.fn().mockResolvedValue(record) } as never,
      {} as never,
      { debug: vi.fn(), error: vi.fn() } as never,
      new VtFlowModuleConfig({ onReconnected }),
    )
    const eventEmitter = {
      on: (type: string, listener: (event: unknown) => Promise<void>) => {
        if (type === VtFlowEventTypes.VtFlowStateChanged) listeners.push(listener)
      },
    }
    const registry = { registerMessageHandlers: vi.fn(), register: vi.fn() }
    const dependencies = new Map<unknown, unknown>([
      [VtFlowService, service],
      [EventEmitter, eventEmitter],
    ])
    const agentContext = {
      dependencyManager: { resolve: (token: unknown) => dependencies.get(token) ?? registry },
    }
    await new VtFlowModule().initialize(agentContext as never)
    const receive = (previousState: VtFlowState) =>
      Promise.all(
        listeners.map(listener =>
          listener({ payload: { vtFlowRecordId: record.id, state: VtFlowState.Validated, previousState } }),
        ),
      )

    await receive(VtFlowState.ValidationTxSubmitted)
    expect(onReconnected).not.toHaveBeenCalled()

    await receive(VtFlowState.Validated)
    expect(onReconnected).toHaveBeenCalledExactlyOnceWith({ agentContext, record })
  })
})
