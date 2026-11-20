import { DidCommCredentialEventTypes, DidCommCredentialState, MessageSendingError } from '@credo-ts/didcomm'
import {
  VtFlowEventTypes,
  VtFlowRole,
  VtFlowService,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { watchIssuanceRepair } from '../src/vtFlow/issuanceRepair'

describe('applicant issuance repair', () => {
  const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'
  let flows = 0

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeRepairAgent(flow: Record<string, unknown> = {}) {
    const handlers = new Map<string, Array<(event: unknown) => unknown>>()
    let middleware!: (context: unknown, next: () => Promise<void>) => Promise<void>
    const record: Record<string, unknown> & { id: string } = {
      id: `flow-${++flows}`,
      role: VtFlowRole.Applicant,
      state: VtFlowState.CredOffered,
      variant: VtFlowVariant.OnboardingProcess,
      connectionId: 'conn-1',
      threadId: 'thid-1',
      ...flow,
    }
    const exchange = {
      id: 'cx-1',
      role: 'holder',
      threadId: 'sub-1',
      parentThreadId: 'thid-1',
      connectionId: 'conn-1',
      state: DidCommCredentialState.RequestSent,
    }
    const vtFlowApi = {
      findByThreadId: vi.fn(async () => record),
      findById: vi.fn(async () => record),
      resendOnboardingRequest: vi.fn(async () => record),
      resendIssuanceRequest: vi.fn(async () => record),
    }
    const vtFlowService = {
      setErrorMessage: vi.fn(async (_context: unknown, _id: string, cause?: string) => {
        record.errorMessage = cause
      }),
    }
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const agent = {
      context: {},
      events: {
        on: (type: string, handler: (event: unknown) => unknown) =>
          handlers.set(type, [...(handlers.get(type) ?? []), handler]),
      },
      dependencyManager: {
        resolve: (token: unknown) => (token === VtFlowService ? vtFlowService : vtFlowApi),
      },
      didcomm: {
        registerMessageHandlerMiddleware: (registered: typeof middleware) => {
          middleware = registered
        },
        credentials: { findAllByQuery: vi.fn(async () => [exchange]) },
        connections: { findById: vi.fn(async () => ({ isReady: true })) },
      },
    }
    watchIssuanceRepair(agent as never, logger as never)

    const emit = async (type: string, payload: unknown) => {
      for (const handler of handlers.get(type) ?? []) await handler({ payload })
    }
    const credentialEvent = (state: DidCommCredentialState) =>
      emit(DidCommCredentialEventTypes.DidCommCredentialStateChanged, {
        credentialExchangeRecord: { ...exchange, state },
        previousState: null,
      })
    const report = () =>
      middleware(
        {
          message: {
            id: 'report-1',
            type: PROBLEM_REPORT,
            thread: { parentThreadId: 'sub-1' },
            code: 'e.p.msg.message-parse-failure',
            args: ['Error validating message'],
          },
          connection: { id: 'conn-1' },
        },
        async () => undefined,
      )
    return { record, exchange, vtFlowApi, logger, emit, credentialEvent, report }
  }

  it('repairs once after a problem report on its request, and records the cause at the second one', async () => {
    const { record, exchange, vtFlowApi, logger, credentialEvent, report } = makeRepairAgent()
    await credentialEvent(DidCommCredentialState.RequestSent)

    await report()
    expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledExactlyOnceWith({
      vtFlowRecordId: record.id,
      connectionId: 'conn-1',
    })

    await report()
    expect(record.errorMessage).toContain('e.p.msg.message-parse-failure')
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(record.id))
    await vi.advanceTimersByTimeAsync(600_000)
    expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledTimes(1)
    expect(exchange.state).toBe(DidCommCredentialState.RequestSent)
  })

  it('repairs 10, 25 and 45 seconds after a request with no answer, and records the cause at 60 seconds', async () => {
    const { record, vtFlowApi, credentialEvent } = makeRepairAgent()
    await credentialEvent(DidCommCredentialState.RequestSent)
    const start = Date.now()

    for (const [at, repairs] of [
      [9_999, 0],
      [10_000, 1],
      [25_000, 2],
      [45_000, 3],
    ]) {
      await vi.advanceTimersByTimeAsync(start + at - Date.now())
      expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledTimes(repairs)
    }
    expect(record.errorMessage).toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(record.errorMessage).toBe('the validator did not answer the credential request')
    await vi.advanceTimersByTimeAsync(600_000)
    expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledTimes(3)
  })

  it('repairs again 1, 2 and 5 minutes after the request when the validator cannot be reached, and then stops', async () => {
    const { record, vtFlowApi, credentialEvent } = makeRepairAgent()
    vtFlowApi.resendOnboardingRequest.mockRejectedValue(
      new MessageSendingError('connection refused', {
        outboundMessageContext: {} as never,
        reason: {} as never,
      }),
    )
    await credentialEvent(DidCommCredentialState.RequestSent)
    const start = Date.now()

    for (const [at, repairs] of [
      [10_000, 1],
      [59_999, 1],
      [60_000, 2],
      [120_000, 3],
      [299_999, 3],
      [300_000, 4],
      [900_000, 4],
    ]) {
      await vi.advanceTimersByTimeAsync(start + at - Date.now())
      expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledTimes(repairs)
    }
    expect(record.errorMessage).toContain('the validator cannot be reached')
  })

  it('repairs a Direct Issuance flow with its issuance-request', async () => {
    const { vtFlowApi, credentialEvent } = makeRepairAgent({ variant: VtFlowVariant.DirectIssuance })
    await credentialEvent(DidCommCredentialState.RequestSent)

    await vi.advanceTimersByTimeAsync(10_000)

    expect(vtFlowApi.resendIssuanceRequest).toHaveBeenCalledTimes(1)
    expect(vtFlowApi.resendOnboardingRequest).not.toHaveBeenCalled()
  })

  it('stops the repair when a renewal moves the flow out of CRED_OFFERED', async () => {
    const { record, vtFlowApi, emit, credentialEvent } = makeRepairAgent()
    await credentialEvent(DidCommCredentialState.RequestSent)

    await emit(VtFlowEventTypes.VtFlowStateChanged, {
      vtFlowRecordId: record.id,
      state: VtFlowState.OrSent,
      previousState: VtFlowState.CredOffered,
    })
    await vi.advanceTimersByTimeAsync(600_000)

    expect(vtFlowApi.resendOnboardingRequest).not.toHaveBeenCalled()
    expect(record.errorMessage).toBeUndefined()
  })

  it('stops the repair and clears the cause when the credential arrives late', async () => {
    const { record, vtFlowApi, credentialEvent } = makeRepairAgent()
    await credentialEvent(DidCommCredentialState.RequestSent)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(record.errorMessage).toBeDefined()

    await credentialEvent(DidCommCredentialState.CredentialReceived)
    await vi.advanceTimersByTimeAsync(600_000)

    expect(record.errorMessage).toBeUndefined()
    expect(vtFlowApi.resendOnboardingRequest).toHaveBeenCalledTimes(3)
  })
})
