import { CredoError } from '@credo-ts/core'
import { ConflictException } from '@nestjs/common'
import {
  VtFlowErrorCode,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { HOLDER_PARTICIPANT_TYPE, VtFlowOrchestrator } from '@verana-labs/vs-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import { AdminApiError, AdminApiErrorCode } from '../src/common'
import { VtFlowsService } from '../src/controllers/admin/vt-flow/VtFlowsService'

function flowRecord(id: string, createdAtMs: number, state: VtFlowState = VtFlowState.Validating) {
  return {
    id,
    threadId: `thid-${id}`,
    participantSessionId: `sess-${id}`,
    connectionId: 'conn-1',
    role: VtFlowRole.Validator,
    variant: VtFlowVariant.OnboardingProcess,
    applicantParticipantId: '42',
    applicantParticipantRole: HOLDER_PARTICIPANT_TYPE,
    state,
    createdAt: new Date(createdAtMs),
    assertState(expected: VtFlowState | VtFlowState[]) {
      const states = Array.isArray(expected) ? expected : [expected]
      if (!states.includes(this.state)) throw new CredoError(`state '${this.state}' not in [${states}]`)
    },
  }
}

function makeService(
  vtFlowApi: Record<string, unknown>,
  options: {
    connection?: { isReady: boolean; theirDid?: string; previousTheirDids: string[] } | null
    applicantOpState?: string
  } = {},
) {
  const connection =
    options.connection === undefined
      ? { isReady: true, theirDid: 'did:web:peer', previousTheirDids: [] }
      : options.connection
  const agent = {
    dependencyManager: { resolve: () => vtFlowApi },
    didcomm: { connections: { findById: vi.fn().mockResolvedValue(connection) } },
    indexer: {
      getParticipant: vi.fn().mockResolvedValue({ op_state: options.applicantOpState ?? 'PENDING' }),
    },
  }
  return new VtFlowsService({ getAgent: async () => agent } as never)
}

describe('VtFlowsService v2 routes', () => {
  it('maps the camelCase v2 filters onto record tags', async () => {
    const findAllByQuery = vi.fn().mockResolvedValue([])
    const service = makeService({ findAllByQuery })

    await service.listFlowsPage({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.Validating,
      applicantParticipantId: '42',
      validatorParticipantId: '7',
      schemaId: '5',
      participantSessionId: 'sess-1',
    })

    expect(findAllByQuery).toHaveBeenCalledWith({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.Validating,
      applicantParticipantId: '42',
      validatorParticipantId: '7',
      schemaId: '5',
      participantSessionId: 'sess-1',
    })
  })

  it('walks the whole collection over the keyset cursor and ends with a null cursor', async () => {
    const records = [flowRecord('a', 1000), flowRecord('b', 2000), flowRecord('c', 3000)]
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue(records) })

    const first = await service.listFlowsPage({ limit: 2 })
    expect(first.items.map(item => item.id)).toEqual(['a', 'b'])
    expect(first.nextCursor).not.toBeNull()
    expect(first.items[0].lastEventAt).toEqual(new Date(1000))

    const second = await service.listFlowsPage({ limit: 2, cursor: first.nextCursor! })
    expect(second.items.map(item => item.id)).toEqual(['c'])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a cursor replayed against a different filter set with INVALID_CURSOR', async () => {
    const records = [flowRecord('a', 1000), flowRecord('b', 2000), flowRecord('c', 3000)]
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue(records) })

    const first = await service.listFlowsPage({ limit: 2 })
    await expect(
      service.listFlowsPage({ limit: 2, cursor: first.nextCursor!, role: VtFlowRole.Validator }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidCursor, status: 400 })

    await expect(service.listFlowsPage({ cursor: 'zzz' })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidCursor,
      status: 400,
    })
  })

  it('returns the flow of a session with its flow state and connection state', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) })

    const flow = await service.getFlow('sess-a')

    expect(flow).toMatchObject({
      id: 'a',
      participantSessionId: 'sess-a',
      flowState: VtFlowState.Validating,
      connectionState: 'ESTABLISHED',
      peerDid: 'did:web:peer',
    })
  })

  it('reports the flow state and the connection state on every listed flow', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) })

    const page = await service.listFlowsPage({})

    expect(page.items[0]).toMatchObject({
      flowState: VtFlowState.Validating,
      connectionState: 'ESTABLISHED',
    })
  })

  it('lists a flow that has no messages with an empty messages array', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) })

    const page = await service.listFlowsPage({})

    expect(page.items[0].messages).toEqual([])
  })

  it('reports NOT_CONNECTED while the connection of a live flow is not ready', async () => {
    const service = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) },
      { connection: { isReady: false, theirDid: 'did:web:peer', previousTheirDids: [] } },
    )

    await expect(service.getFlow('sess-a')).resolves.toMatchObject({
      connectionState: 'NOT_CONNECTED',
      flowState: VtFlowState.Validating,
    })
  })

  it('reports TERMINATED for a flow in a terminal state, and for a lost connection', async () => {
    const terminal = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000, VtFlowState.TerminatedByValidator)]),
    })
    await expect(terminal.getFlow('sess-a')).resolves.toMatchObject({ connectionState: 'TERMINATED' })

    const lost = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]) },
      { connection: null },
    )
    await expect(lost.getFlow('sess-a')).resolves.toMatchObject({
      connectionState: 'TERMINATED',
      peerDid: undefined,
    })
  })

  it('rejects an unknown participant session with UNKNOWN_ID and status 404', async () => {
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([]) })

    const rejection = expect(service.getFlow('sess-missing')).rejects
    await rejection.toBeInstanceOf(AdminApiError)
    await rejection.toMatchObject({ code: AdminApiErrorCode.UnknownId, status: 404 })
  })

  it('validates the flow that the path names, whatever the body carries', async () => {
    const findById = vi.fn().mockResolvedValue(null)
    const vtFlowApi = { findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]), findById }
    const agent = { veranaChain: {}, dependencyManager: { resolve: () => vtFlowApi } }
    const service = new VtFlowsService({ getAgent: async () => agent } as never)

    await expect(service.validateFlow('sess-a', { vtFlowRecordId: 'b' } as never)).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
    expect(findById).toHaveBeenCalledWith('a')
  })

  it('sends the oob-link description and expiry to the applicant', async () => {
    const sendOobLink = vi.fn().mockResolvedValue(flowRecord('a', 1000, VtFlowState.OobPending))
    const service = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]),
      sendOobLink,
    })

    await service.sendOobLink('sess-a', 'https://collect.example/form', 'Upload', '2026-10-01T00:00:00Z')

    expect(sendOobLink).toHaveBeenCalledWith({
      vtFlowRecordId: 'a',
      url: 'https://collect.example/form',
      description: 'Upload',
      expiresTime: new Date('2026-10-01T00:00:00Z'),
    })
  })

  it('starts validation with the comment, and refuses it with 409 on a connection that is not ESTABLISHED', async () => {
    const sendValidating = vi.fn().mockResolvedValue(flowRecord('a', 1000))
    const records = vi.fn().mockResolvedValue([flowRecord('a', 1000, VtFlowState.OobPending)])

    const flow = await makeService({ findAllByQuery: records, sendValidating }).startValidation(
      'sess-a',
      'Thanks',
    )
    expect(sendValidating).toHaveBeenCalledWith('a', { comment: 'Thanks' })
    expect(flow.state).toBe(VtFlowState.Validating)

    sendValidating.mockClear()
    const notConnected = makeService(
      { findAllByQuery: records, sendValidating },
      { connection: { isReady: false, previousTheirDids: [] } },
    )
    await expect(notConnected.startValidation('sess-a')).rejects.toThrow(ConflictException)
    expect(sendValidating).not.toHaveBeenCalled()
  })

  it('edits the claims only in the accepted states, per [VSA-ADM-VT-FL-EDIT]', async () => {
    const updateClaims = vi.fn(async (id: string) => flowRecord(id, 1000))
    const awaitingOr = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000, VtFlowState.AwaitingOr)]),
      updateClaims,
    })
    await expect(awaitingOr.editCredentialClaims('sess-a', { name: 'Acme' })).rejects.toThrow(
      ConflictException,
    )
    expect(updateClaims).not.toHaveBeenCalled()

    const awaitingTx = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000, VtFlowState.AwaitingValidationTx)]),
      updateClaims,
    })
    await awaitingTx.editCredentialClaims('sess-a', { name: 'Acme' })
    expect(updateClaims).toHaveBeenCalledWith('a', { name: 'Acme' })
  })

  it('refuses a claim edit with NO_CREDENTIAL_FOR_ROLE when the applicant role is not HOLDER', async () => {
    const issuer = { ...flowRecord('a', 1000), applicantParticipantRole: 3 }
    const updateClaims = vi.fn()
    const service = makeService({ findAllByQuery: vi.fn().mockResolvedValue([issuer]), updateClaims })

    await expect(service.editCredentialClaims('sess-a', {})).rejects.toMatchObject({
      code: AdminApiErrorCode.NoCredentialForRole,
      status: 409,
    })
    expect(updateClaims).not.toHaveBeenCalled()
  })

  it('rejects a flow with a problem-report, vt-flow.validation-refused by default', async () => {
    const terminateSessionAsValidator = vi
      .fn()
      .mockResolvedValue(flowRecord('a', 1000, VtFlowState.TerminatedByValidator))
    const service = makeService({
      findAllByQuery: vi.fn().mockResolvedValue([flowRecord('a', 1000)]),
      terminateSessionAsValidator,
    })

    const flow = await service.rejectFlow('sess-a', { description: 'Documents do not match' })

    expect(terminateSessionAsValidator).toHaveBeenCalledWith({
      vtFlowRecordId: 'a',
      code: VtFlowErrorCode.ValidationRefused,
      enDescription: 'Documents do not match',
    })
    expect(flow).toMatchObject({ state: VtFlowState.TerminatedByValidator, connectionState: 'TERMINATED' })
  })

  it('refuses a reject in VALIDATION_TX_SUBMITTED, from VALIDATED on, and outside the Direct Issuance states', async () => {
    const terminateSessionAsValidator = vi.fn()
    const rejectIn = (record: ReturnType<typeof flowRecord>) =>
      makeService({
        findAllByQuery: vi.fn().mockResolvedValue([record]),
        terminateSessionAsValidator,
      }).rejectFlow('sess-a', { description: 'no' })

    for (const state of [VtFlowState.ValidationTxSubmitted, VtFlowState.Validated, VtFlowState.CredOffered]) {
      await expect(rejectIn(flowRecord('a', 1000, state))).rejects.toThrow(ConflictException)
    }
    const directIssuance = {
      ...flowRecord('a', 1000, VtFlowState.AwaitingValidationTx),
      variant: VtFlowVariant.DirectIssuance,
    }
    await expect(rejectIn(directIssuance)).rejects.toThrow(ConflictException)
    expect(terminateSessionAsValidator).not.toHaveBeenCalled()
  })

  it('moves the flow to VALIDATED and refuses the reject when the applicant entry is already VALIDATED', async () => {
    const record = flowRecord('a', 1000, VtFlowState.ValidationTxFailed)
    const markValidated = vi.fn().mockResolvedValue(record)
    const terminateSessionAsValidator = vi.fn()
    const continueAfterValidated = vi
      .spyOn(VtFlowOrchestrator.prototype, 'continueAfterValidated')
      .mockResolvedValue(record as never)
    const service = makeService(
      { findAllByQuery: vi.fn().mockResolvedValue([record]), markValidated, terminateSessionAsValidator },
      { applicantOpState: 'VALIDATED' },
    )

    await expect(service.rejectFlow('sess-a', { description: 'no' })).rejects.toThrow(ConflictException)
    expect(markValidated).toHaveBeenCalledWith('a')
    expect(continueAfterValidated).toHaveBeenCalledWith('a')
    expect(terminateSessionAsValidator).not.toHaveBeenCalled()
    continueAfterValidated.mockRestore()
  })
})
