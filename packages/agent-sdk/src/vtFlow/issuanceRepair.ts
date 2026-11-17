import type { VsAgent } from '../agent/VsAgent'
import type { BaseLogger } from '@credo-ts/core'

import {
  DidCommCredentialEventTypes,
  DidCommCredentialRole,
  DidCommCredentialState,
  MessageSendingError,
  type DidCommCredentialStateChangedEvent,
  type DidCommMessage,
} from '@credo-ts/didcomm'
import {
  VtFlowApi,
  VtFlowEventTypes,
  VtFlowRole,
  VtFlowService,
  VtFlowState,
  VtFlowVariant,
  type VtFlowStateChangedEvent,
} from '@verana-labs/credo-ts-didcomm-vt-flow'

const UNANSWERED_REPAIRS_MS = [10_000, 25_000, 45_000]
const UNDELIVERABLE_REPAIRS_MS = [60_000, 120_000, 300_000]
const NOTICE_MS = 60_000

const PROBLEM_REPORT_TYPES = [
  'https://didcomm.org/report-problem/2.0/problem-report',
  'https://didcomm.org/notification/1.0/problem-report',
]

interface Repair {
  timers: ReturnType<typeof setTimeout>[]
  problemReports: number
  undeliverable?: string
  cause?: string
}

const repairs = new Map<string, Repair>()

export function watchIssuanceRepair(agent: VsAgent, logger: BaseLogger): void {
  agent.events.on<DidCommCredentialStateChangedEvent>(
    DidCommCredentialEventTypes.DidCommCredentialStateChanged,
    async ({ payload: { credentialExchangeRecord: exchange, previousState } }) => {
      if (exchange.role !== DidCommCredentialRole.Holder || !exchange.parentThreadId) return
      try {
        const record = await agent.dependencyManager
          .resolve(VtFlowApi)
          .findByThreadId(exchange.parentThreadId)
        if (record?.role !== VtFlowRole.Applicant || record.state !== VtFlowState.CredOffered) return

        if (exchange.state === DidCommCredentialState.RequestSent && !repairs.has(record.id)) {
          start(agent, logger, record.id)
        } else if (
          exchange.state === DidCommCredentialState.Abandoned &&
          previousState === DidCommCredentialState.RequestSent
        ) {
          await problemReported(
            agent,
            logger,
            record.id,
            exchange.errorMessage ?? 'the validator refused the request',
          )
        } else if (exchange.state === DidCommCredentialState.CredentialReceived) {
          stop(record.id)
          if (record.errorMessage) await setCause(agent, record.id, undefined)
        }
      } catch (error) {
        logger.error(`[vt-flow] issuance repair failed: ${(error as Error).message}`)
      }
    },
  )

  agent.events.on<VtFlowStateChangedEvent>(VtFlowEventTypes.VtFlowStateChanged, ({ payload }) => {
    if (payload.state !== VtFlowState.CredOffered) stop(payload.vtFlowRecordId)
  })

  // Credo sends this report when it cannot read a message. No protocol handler reads it.
  agent.didcomm.registerMessageHandlerMiddleware(async (messageContext, next) => {
    const { message, connection } = messageContext
    const parentThreadId = message.thread?.parentThreadId
    if (!PROBLEM_REPORT_TYPES.includes(message.type) || !parentThreadId || !connection) return next()
    try {
      await next()
    } finally {
      await reportRefusedRequest(agent, logger, message, parentThreadId, connection.id)
    }
  })
}

async function reportRefusedRequest(
  agent: VsAgent,
  logger: BaseLogger,
  message: DidCommMessage,
  parentThreadId: string,
  connectionId: string,
): Promise<void> {
  try {
    const [exchange] = await agent.didcomm.credentials.findAllByQuery({
      threadId: parentThreadId,
      role: DidCommCredentialRole.Holder,
      state: DidCommCredentialState.RequestSent,
    })
    if (!exchange?.parentThreadId || exchange.connectionId !== connectionId) return
    const record = await agent.dependencyManager.resolve(VtFlowApi).findByThreadId(exchange.parentThreadId)
    if (record?.role !== VtFlowRole.Applicant || record.state !== VtFlowState.CredOffered) return

    const report = message as unknown as {
      code?: string
      args?: string[]
      description?: { code?: string; en?: string }
    }
    const code = report.code ?? report.description?.code ?? 'problem-report'
    const detail = report.args?.join(', ') ?? report.description?.en
    // The run stays open: a validator that holds the request can still deliver the credential.
    await problemReported(agent, logger, record.id, detail ? `${code}: ${detail}` : code)
  } catch (error) {
    logger.error(`[vt-flow] cannot read the problem report ${message.id}: ${(error as Error).message}`)
  }
}

export async function repairIssuance(agent: VsAgent, logger: BaseLogger, recordId: string): Promise<void> {
  const repair = repairs.get(recordId) ?? start(agent, logger, recordId)
  await attempt(agent, logger, recordId, repair)
}

function start(agent: VsAgent, logger: BaseLogger, recordId: string): Repair {
  const repair: Repair = { timers: [], problemReports: 0 }
  repairs.set(recordId, repair)
  const at = (ms: number, task: () => Promise<void>) => {
    const timer = setTimeout(() => void task().catch(error => logger.error(`[vt-flow] ${error}`)), ms)
    timer.unref?.()
    repair.timers.push(timer)
  }
  for (const ms of UNANSWERED_REPAIRS_MS) {
    at(ms, async () => {
      if (!repair.problemReports && !repair.undeliverable) await attempt(agent, logger, recordId, repair)
    })
  }
  UNDELIVERABLE_REPAIRS_MS.forEach((ms, index) => {
    at(ms, async () => {
      if (repair.undeliverable) await attempt(agent, logger, recordId, repair)
      if (index < UNDELIVERABLE_REPAIRS_MS.length - 1) return
      if (repair.undeliverable) await notice(agent, logger, recordId, repair)
      stop(recordId)
    })
  })
  at(NOTICE_MS, async () => {
    await notice(agent, logger, recordId, repair)
    if (!repair.undeliverable) stop(recordId)
  })
  return repair
}

function stop(recordId: string): void {
  const repair = repairs.get(recordId)
  if (!repair) return
  for (const timer of repair.timers) clearTimeout(timer)
  repairs.delete(recordId)
}

async function problemReported(agent: VsAgent, logger: BaseLogger, recordId: string, cause: string) {
  const repair = repairs.get(recordId) ?? start(agent, logger, recordId)
  repair.problemReports++
  repair.cause = `the validator could not process the credential request: ${cause}`
  if (repair.problemReports === 1) return attempt(agent, logger, recordId, repair)
  await notice(agent, logger, recordId, repair)
  stop(recordId)
}

async function attempt(agent: VsAgent, logger: BaseLogger, recordId: string, repair: Repair): Promise<void> {
  const record = await agent.dependencyManager.resolve(VtFlowApi).findById(recordId)
  if (record?.role !== VtFlowRole.Applicant || record.state !== VtFlowState.CredOffered) return stop(recordId)
  const connection = await agent.didcomm.connections.findById(record.connectionId)
  if (!connection?.isReady) {
    repair.undeliverable = 'the connection of the flow is not established'
    return
  }

  const api = agent.dependencyManager.resolve(VtFlowApi)
  const options = { vtFlowRecordId: record.id, connectionId: record.connectionId }
  try {
    if (record.variant === VtFlowVariant.DirectIssuance) await api.resendIssuanceRequest(options)
    else await api.resendOnboardingRequest(options)
    repair.undeliverable = undefined
    logger.warn(`[vt-flow] resent the request of flow ${record.id} to repair its issuance`)
  } catch (error) {
    if (!(error instanceof MessageSendingError)) throw error
    repair.undeliverable = error.message
    logger.warn(`[vt-flow] the validator of flow ${record.id} cannot be reached: ${error.message}`)
  }
}

async function notice(agent: VsAgent, logger: BaseLogger, recordId: string, repair: Repair): Promise<void> {
  const record = await agent.dependencyManager.resolve(VtFlowApi).findById(recordId)
  if (record?.state !== VtFlowState.CredOffered) return
  const cause =
    repair.cause ??
    (repair.undeliverable
      ? `the validator cannot be reached: ${repair.undeliverable}`
      : 'the validator did not answer the credential request')
  logger.error(`[vt-flow] the issuance of flow ${recordId} is not repaired: ${cause}`)
  await setCause(agent, recordId, cause)
}

function setCause(agent: VsAgent, recordId: string, cause: string | undefined): Promise<void> {
  return agent.dependencyManager.resolve(VtFlowService).setErrorMessage(agent.context, recordId, cause)
}
