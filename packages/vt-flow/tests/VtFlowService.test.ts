import { EventEmitter, JsonTransformer, utils } from '@credo-ts/core'
import { DidCommCredentialExchangeRepository, WhoRetriesStatus } from '@credo-ts/didcomm'
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

function makeService(existing: VtFlowRecord | null, previousConnection: unknown = null) {
  const repository = {
    findByParticipantSessionId: vi.fn().mockResolvedValue(existing),
    getById: vi.fn().mockResolvedValue(existing),
    findByThreadId: vi.fn().mockResolvedValue(existing),
    save: vi.fn(),
    update: vi.fn(),
  }
  const eventEmitter = { emit: vi.fn() }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const config = { assertVerifiableService: undefined }
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
    expect(record.connectionId).toBe('conn-new')
    expect(stale.parentThreadId).toBeUndefined()
    expect(exchangeRepository.update).toHaveBeenCalledWith(agentContext, stale)
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

  it('auto-accept an onboarding-request that re-entered a VALIDATED flow on a renewal', async () => {
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

    const event = {
      payload: {
        vtFlowRecordId: record.id,
        state: VtFlowState.AwaitingOr,
        previousState: VtFlowState.Validated,
      },
    }
    await Promise.all(listeners.map(listener => listener(event)))

    expect(vtFlowApi.acceptOnboardingRequest).toHaveBeenCalledWith(record.id)
  })
})
