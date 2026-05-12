import type { AgentContext, Logger, Query, QueryOptions } from '@credo-ts/core'
import type {
  DidCommConnectionDidRotatedEvent,
  DidCommCredentialExchangeRecord,
  DidCommInboundMessageContext,
} from '@credo-ts/didcomm'

import { CredoError, EventEmitter, InjectionSymbols, inject, injectable } from '@credo-ts/core'
import { DidCommConnectionEventTypes, DidCommConnectionsApi, DidCommCredentialState } from '@credo-ts/didcomm'
import { filter, firstValueFrom, timeout } from 'rxjs'

import { VtFlowModuleConfig } from '../VtFlowModuleConfig'
import { type BuildVtFlowProblemReportOptions, VtFlowErrorCode, buildVtFlowProblemReport } from '../errors'
import {
  CredentialStateChangeMessage,
  type CredentialStateChangeMessageOptions,
  IssuanceRequestMessage,
  OobLinkMessage,
  type OobLinkMessageOptions,
  ValidatingMessage,
  type ValidatingMessageOptions,
  ValidationRequestMessage,
  VtCredentialState,
} from '../messages'
import { VtFlowRecord, VtFlowRepository } from '../repository'
import {
  VtFlowEventTypes,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
  type VtFlowStateChangedEvent,
} from '../types'

export interface CreateValidationRequestParams {
  connectionId: string
  sessionUuid: string
  permId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
  peerPublicDid?: string
}

export interface CreateIssuanceRequestParams {
  connectionId: string
  sessionUuid: string
  schemaId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
  peerPublicDid?: string
}

export interface SendOobLinkParams extends Omit<OobLinkMessageOptions, 'threadId' | 'id'> {}

export interface SendValidatingParams extends Omit<ValidatingMessageOptions, 'threadId' | 'id'> {}

export interface NotifyCredentialStateChangeParams
  extends Omit<CredentialStateChangeMessageOptions, 'threadId' | 'id'> {}

export interface RejectRequestParams {
  code: VtFlowErrorCode
  enDescription?: string
  fixHintEn?: string
}

/** Core state machine for vt-flow; each method performs one transition and returns the wire message without dispatching (dispatch lives in `VtFlowApi`). */
@injectable()
export class VtFlowService {
  private readonly repository: VtFlowRepository
  private readonly eventEmitter: EventEmitter
  private readonly logger: Logger
  private readonly config: VtFlowModuleConfig

  public constructor(
    repository: VtFlowRepository,
    eventEmitter: EventEmitter,
    @inject(InjectionSymbols.Logger) logger: Logger,
    config: VtFlowModuleConfig,
  ) {
    this.repository = repository
    this.eventEmitter = eventEmitter
    this.logger = logger
    this.config = config
  }

  /** Applicant-side §5.1: build the outbound `validation-request` and persist a record in `VR_SENT`. */
  public async createValidationProcessRecord(
    agentContext: AgentContext,
    params: CreateValidationRequestParams,
  ): Promise<{ message: ValidationRequestMessage; record: VtFlowRecord }> {
    const message = new ValidationRequestMessage({
      permId: params.permId,
      sessionUuid: params.sessionUuid,
      agentPermId: params.agentPermId,
      walletAgentPermId: params.walletAgentPermId,
      claims: params.claims,
    })
    message.setThread({ threadId: message.id })

    const record = new VtFlowRecord({
      threadId: message.id,
      sessionUuid: params.sessionUuid,
      connectionId: params.connectionId,
      role: VtFlowRole.Applicant,
      state: VtFlowState.VrSent,
      variant: VtFlowVariant.ValidationProcess,
      agentPermId: params.agentPermId,
      walletAgentPermId: params.walletAgentPermId,
      permId: params.permId,
      claims: params.claims,
      peerPublicDid: params.peerPublicDid,
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null)
    return { message, record }
  }

  /** Applicant-side §5.2: build the outbound `issuance-request` and persist a record in `IR_SENT`. */
  public async createDirectIssuanceRecord(
    agentContext: AgentContext,
    params: CreateIssuanceRequestParams,
  ): Promise<{ message: IssuanceRequestMessage; record: VtFlowRecord }> {
    const message = new IssuanceRequestMessage({
      schemaId: params.schemaId,
      sessionUuid: params.sessionUuid,
      agentPermId: params.agentPermId,
      walletAgentPermId: params.walletAgentPermId,
      claims: params.claims,
    })
    message.setThread({ threadId: message.id })

    const record = new VtFlowRecord({
      threadId: message.id,
      sessionUuid: params.sessionUuid,
      connectionId: params.connectionId,
      role: VtFlowRole.Applicant,
      state: VtFlowState.IrSent,
      variant: VtFlowVariant.DirectIssuance,
      agentPermId: params.agentPermId,
      walletAgentPermId: params.walletAgentPermId,
      schemaId: params.schemaId,
      claims: params.claims,
      peerPublicDid: params.peerPublicDid,
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null)
    return { message, record }
  }

  /** Validator-side §5.1: create or re-attach (by `session_uuid`) a record in `AWAITING_VR` from an inbound `validation-request`. */
  public async processReceiveValidationRequest(
    messageContext: DidCommInboundMessageContext<ValidationRequestMessage>,
  ): Promise<VtFlowRecord> {
    const { message, agentContext } = messageContext
    const connection = messageContext.assertReadyConnection()
    const peerDid = connection.theirDid
    if (!peerDid) throw new CredoError(`vt-flow: ready connection '${connection.id}' has no theirDid`)
    await this.assertVerifiableService(agentContext, peerDid, connection.id)

    const existing = await this.repository.findBySessionUuid(
      agentContext,
      message.sessionUuid,
      VtFlowRole.Validator,
    )
    if (existing) {
      existing.connectionId = connection.id
      existing.threadId = message.threadId
      existing.peerPublicDid = existing.peerPublicDid ?? peerDid
      await this.repository.update(agentContext, existing)
      return existing
    }

    const record = new VtFlowRecord({
      threadId: message.threadId,
      sessionUuid: message.sessionUuid,
      connectionId: connection.id,
      role: VtFlowRole.Validator,
      state: VtFlowState.AwaitingVr,
      variant: VtFlowVariant.ValidationProcess,
      agentPermId: message.agentPermId,
      walletAgentPermId: message.walletAgentPermId,
      permId: message.permId,
      claims: message.claims,
      peerPublicDid: peerDid,
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null)
    return record
  }

  /** Validator-side §5.2 counterpart of `processReceiveValidationRequest`, landing the record in `AWAITING_IR`. */
  public async processReceiveIssuanceRequest(
    messageContext: DidCommInboundMessageContext<IssuanceRequestMessage>,
  ): Promise<VtFlowRecord> {
    const { message, agentContext } = messageContext
    const connection = messageContext.assertReadyConnection()
    const peerDid = connection.theirDid
    if (!peerDid) throw new CredoError(`vt-flow: ready connection '${connection.id}' has no theirDid`)
    await this.assertVerifiableService(agentContext, peerDid, connection.id)

    const existing = await this.repository.findBySessionUuid(
      agentContext,
      message.sessionUuid,
      VtFlowRole.Validator,
    )
    if (existing) {
      existing.connectionId = connection.id
      existing.threadId = message.threadId
      existing.peerPublicDid = existing.peerPublicDid ?? connection.theirDid
      await this.repository.update(agentContext, existing)
      return existing
    }

    const record = new VtFlowRecord({
      threadId: message.threadId,
      sessionUuid: message.sessionUuid,
      connectionId: connection.id,
      role: VtFlowRole.Validator,
      state: VtFlowState.AwaitingIr,
      variant: VtFlowVariant.DirectIssuance,
      agentPermId: message.agentPermId,
      walletAgentPermId: message.walletAgentPermId,
      schemaId: message.schemaId,
      claims: message.claims,
      peerPublicDid: connection.theirDid,
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null)
    return record
  }

  /** Applicant-side inbound `oob-link`; transitions the session to `OOB_PENDING`. */
  public async processReceiveOobLink(
    messageContext: DidCommInboundMessageContext<OobLinkMessage>,
  ): Promise<VtFlowRecord> {
    const { message, agentContext } = messageContext
    messageContext.assertReadyConnection()

    const record = await this.getByThreadId(agentContext, message.threadId)
    record.assertRole(VtFlowRole.Applicant)
    await this.updateState(agentContext, record, VtFlowState.OobPending)
    return record
  }

  /** Applicant-side inbound `validating`; informational only, no state change. */
  public async processReceiveValidating(
    messageContext: DidCommInboundMessageContext<ValidatingMessage>,
  ): Promise<VtFlowRecord> {
    const { message, agentContext } = messageContext
    messageContext.assertReadyConnection()

    const record = await this.getByThreadId(agentContext, message.threadId)
    this.logger.debug(
      `[vt-flow] validating received for session ${record.threadId}: ${message.comment ?? '(no comment)'}`,
    )
    return record
  }

  /** Applicant-side inbound `credential-state-change`; v1.0 handles `REVOKED` only. */
  public async processReceiveCredentialStateChange(
    messageContext: DidCommInboundMessageContext<CredentialStateChangeMessage>,
  ): Promise<VtFlowRecord | null> {
    const { message, agentContext } = messageContext
    messageContext.assertReadyConnection()

    const record = await this.repository.findByThreadId(agentContext, message.threadId)
    if (!record) {
      this.logger.warn(`[vt-flow] credential-state-change for unknown thread ${message.threadId}; ignoring`)
      return null
    }

    if (message.state === VtCredentialState.Revoked) {
      await this.updateState(agentContext, record, VtFlowState.CredRevoked)
    } else {
      this.logger.debug(`[vt-flow] credential-state-change: ignoring unknown state '${message.state}'`)
    }

    return record
  }

  /** `AWAITING_VR => VALIDATING`; caller is expected to have verified perm/agent/wallet IDs on-chain. */
  public async acceptValidationRequest(agentContext: AgentContext, recordId: string): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState(VtFlowState.AwaitingVr)
    record.assertVariant(VtFlowVariant.ValidationProcess)

    await this.updateState(agentContext, record, VtFlowState.Validating)
    return record
  }

  /** §5.2: `AWAITING_IR => VALIDATING`; transient before `CRED_OFFERED`. */
  public async acceptIssuanceRequest(agentContext: AgentContext, recordId: string): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState(VtFlowState.AwaitingIr)
    record.assertVariant(VtFlowVariant.DirectIssuance)

    await this.updateState(agentContext, record, VtFlowState.Validating)
    return record
  }

  /** Reject with a problem-report; transitions to `TERMINATED_BY_{role}` and marks the connection as `TERMINATED`. */
  public async rejectRequest(
    agentContext: AgentContext,
    recordId: string,
    params: RejectRequestParams,
  ): Promise<{ record: VtFlowRecord; problemReport: ReturnType<typeof buildVtFlowProblemReport> }> {
    const record = await this.repository.getById(agentContext, recordId)

    const problemReport = buildVtFlowProblemReport({
      code: params.code,
      threadId: record.threadId,
      enDescription: params.enDescription,
      fixHintEn: params.fixHintEn,
    })

    const nextState =
      record.role === VtFlowRole.Validator
        ? VtFlowState.TerminatedByValidator
        : VtFlowState.TerminatedByApplicant

    record.errorMessage = params.enDescription ?? params.code

    await this.updateState(agentContext, record, nextState)

    return { record, problemReport }
  }

  /** Applicant-side termination producing a problem-report and landing in `TERMINATED_BY_APPLICANT`. */
  public async terminateByApplicant(
    agentContext: AgentContext,
    recordId: string,
    params: Partial<RejectRequestParams> = {},
  ): Promise<{ record: VtFlowRecord; problemReport: ReturnType<typeof buildVtFlowProblemReport> }> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Applicant)

    const code = params.code ?? VtFlowErrorCode.SessionTerminated
    const problemReport = buildVtFlowProblemReport({
      code,
      threadId: record.threadId,
      enDescription: params.enDescription,
      fixHintEn: params.fixHintEn,
    })

    record.errorMessage = params.enDescription ?? code

    await this.updateState(agentContext, record, VtFlowState.TerminatedByApplicant)

    return { record, problemReport }
  }

  /** Build an `oob-link`; non-terminal records transition to `OOB_PENDING`. */
  public async sendOobLinkForSession(
    agentContext: AgentContext,
    recordId: string,
    params: SendOobLinkParams,
  ): Promise<{ record: VtFlowRecord; message: OobLinkMessage }> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState([
      VtFlowState.AwaitingVr,
      VtFlowState.AwaitingIr,
      VtFlowState.Validating,
      VtFlowState.Completed,
    ])

    const message = new OobLinkMessage({
      threadId: record.threadId,
      url: params.url,
      description: params.description,
      expiresTime: params.expiresTime,
    })

    if (record.state !== VtFlowState.Completed) {
      await this.updateState(agentContext, record, VtFlowState.OobPending)
    }

    return { record, message }
  }

  /** Build a `validating` informational message; no state change. */
  public async sendValidatingForSession(
    agentContext: AgentContext,
    recordId: string,
    params: SendValidatingParams = {},
  ): Promise<{ record: VtFlowRecord; message: ValidatingMessage }> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)

    const message = new ValidatingMessage({
      threadId: record.threadId,
      comment: params.comment,
    })

    return { record, message }
  }

  /** `VALIDATING => VALIDATED`; call after `set-perm-vp-validated` lands on-chain. */
  public async markValidated(agentContext: AgentContext, recordId: string): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState([VtFlowState.Validating, VtFlowState.OobPending])
    record.assertVariant(VtFlowVariant.ValidationProcess)

    await this.updateState(agentContext, record, VtFlowState.Validated)
    return record
  }

  /** Link a Credo exchange record to the session and transition to `CRED_OFFERED`. */
  public async attachCredentialExchangeRecord(
    agentContext: AgentContext,
    recordId: string,
    credentialExchangeRecord: DidCommCredentialExchangeRecord,
  ): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState([
      VtFlowState.Validated,
      VtFlowState.Validating,
      VtFlowState.OobPending,
      VtFlowState.Completed,
    ])

    record.credentialExchangeRecordId = credentialExchangeRecord.id
    record.subprotocolThid = credentialExchangeRecord.threadId

    await this.updateState(agentContext, record, VtFlowState.CredOffered)
    return record
  }

  /** Validator-side `credential-state-change`; `COMPLETED => CRED_REVOKED`. */
  public async notifyCredentialStateChange(
    agentContext: AgentContext,
    recordId: string,
    params: NotifyCredentialStateChangeParams,
  ): Promise<{ record: VtFlowRecord; message: CredentialStateChangeMessage }> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState(VtFlowState.Completed)

    const message = new CredentialStateChangeMessage({
      threadId: record.threadId,
      subprotocolThid: params.subprotocolThid,
      state: params.state,
      reason: params.reason,
    })

    if (params.state === VtCredentialState.Revoked) {
      await this.updateState(agentContext, record, VtFlowState.CredRevoked)
    }

    return { record, message }
  }

  /** Map a Credo credential-exchange state change onto the vt-flow session via `~thread.pthid`. */
  public async onSubprotocolStateChanged(
    agentContext: AgentContext,
    record: VtFlowRecord,
    credentialExchangeRecord: DidCommCredentialExchangeRecord,
  ): Promise<void> {
    if (
      !record.credentialExchangeRecordId ||
      record.credentialExchangeRecordId !== credentialExchangeRecord.id
    ) {
      record.credentialExchangeRecordId = credentialExchangeRecord.id
      record.subprotocolThid = credentialExchangeRecord.threadId
      await this.repository.update(agentContext, record)
    }

    switch (credentialExchangeRecord.state) {
      case DidCommCredentialState.OfferSent:
        if (record.state !== VtFlowState.CredOffered && record.state === VtFlowState.Validated) {
          await this.updateState(agentContext, record, VtFlowState.CredOffered)
        }
        break
      case DidCommCredentialState.OfferReceived:
        if (record.state !== VtFlowState.CredOffered) {
          await this.updateState(agentContext, record, VtFlowState.CredOffered)
        }
        break
      case DidCommCredentialState.CredentialReceived:
        this.logger.debug(
          `[vt-flow] credential received for session ${record.threadId}; awaiting application Ack`,
        )
        break
      case DidCommCredentialState.Done:
        if (record.state !== VtFlowState.Completed) {
          await this.updateState(agentContext, record, VtFlowState.Completed)
        }
        break
      case DidCommCredentialState.Abandoned:
        if (record.state !== VtFlowState.Error) {
          record.errorMessage = record.errorMessage ?? 'Subprotocol abandoned'
          await this.updateState(agentContext, record, VtFlowState.Error)
        }
        break
      default:
        break
    }
  }

  public getById(agentContext: AgentContext, id: string): Promise<VtFlowRecord> {
    return this.repository.getById(agentContext, id)
  }

  public findById(agentContext: AgentContext, id: string): Promise<VtFlowRecord | null> {
    return this.repository.findById(agentContext, id)
  }

  public async getByThreadId(agentContext: AgentContext, threadId: string): Promise<VtFlowRecord> {
    const record = await this.repository.findByThreadId(agentContext, threadId)
    if (!record) {
      throw new CredoError(`VtFlow record with threadId '${threadId}' not found.`)
    }
    return record
  }

  public findByThreadId(agentContext: AgentContext, threadId: string): Promise<VtFlowRecord | null> {
    return this.repository.findByThreadId(agentContext, threadId)
  }

  public findByCredentialExchangeRecordId(
    agentContext: AgentContext,
    credentialExchangeRecordId: string,
  ): Promise<VtFlowRecord | null> {
    return this.repository.findByCredentialExchangeRecordId(agentContext, credentialExchangeRecordId)
  }

  public findAllByQuery(
    agentContext: AgentContext,
    query: Query<VtFlowRecord>,
    queryOptions?: QueryOptions,
  ): Promise<VtFlowRecord[]> {
    return this.repository.findByQuery(agentContext, query, queryOptions)
  }

  /** Transition the record, persist it, and emit `VtFlowStateChanged`. */
  public async updateState(
    agentContext: AgentContext,
    record: VtFlowRecord,
    newState: VtFlowState,
  ): Promise<void> {
    const previousState = record.state
    if (previousState === newState) return

    record.state = newState
    await this.repository.update(agentContext, record)

    this.emitStateChanged(agentContext, record, previousState)
  }

  /** Persist record changes without state-transition semantics (no event emitted). */
  public async updateRecord(agentContext: AgentContext, record: VtFlowRecord): Promise<void> {
    await this.repository.update(agentContext, record)
  }

  private emitStateChanged(
    agentContext: AgentContext,
    record: VtFlowRecord,
    previousState: VtFlowState | null,
  ): void {
    this.eventEmitter.emit<VtFlowStateChangedEvent>(agentContext, {
      type: VtFlowEventTypes.VtFlowStateChanged,
      payload: {
        vtFlowRecordId: record.id,
        threadId: record.threadId,
        sessionUuid: record.sessionUuid,
        state: record.state,
        previousState,
      },
    })
  }

  public getModuleConfig(): VtFlowModuleConfig {
    return this.config
  }

  public getLogger(): Logger {
    return this.logger
  }

  public buildProblemReport(options: BuildVtFlowProblemReportOptions) {
    return buildVtFlowProblemReport(options)
  }

  /** Spec v4 §Verifiable Service Identity Check: invokes the caller-provided VS-CONN-VS hook. Throws `vt-flow.not-a-verifiable-service` when the peer fails the check. When no hook is configured, logs a warning and permits. */
  public async assertVerifiableService(
    agentContext: AgentContext,
    peerDid: string,
    connectionId?: string,
  ): Promise<void> {
    const hook = this.config.assertVerifiableService
    if (!hook) {
      this.logger.warn(
        `[vt-flow] assertVerifiableService hook not configured; skipping VS-CONN-VS check for peer '${peerDid}'. Configure VtFlowModuleConfig.assertVerifiableService for spec-conformant trust resolution.`,
      )
      return
    }
    let permitted = false
    try {
      permitted = await hook({ agentContext, peerDid, connectionId })
    } catch (error) {
      throw new CredoError(
        `vt-flow.not-a-verifiable-service: peer '${peerDid}' failed VS-CONN-VS check (${(error as Error).message})`,
      )
    }
    if (!permitted) {
      throw new CredoError(`vt-flow.not-a-verifiable-service: peer '${peerDid}' failed VS-CONN-VS check`)
    }
  }

  public async rotateAndWait(
    agentContext: AgentContext,
    connectionId: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{ newDid: string }> {
    const connectionsApi = agentContext.dependencyManager.resolve(DidCommConnectionsApi)

    const rotated$ = this.eventEmitter
      .observable<DidCommConnectionDidRotatedEvent>(DidCommConnectionEventTypes.DidCommConnectionDidRotated)
      .pipe(
        filter(event => event.payload.connectionRecord.id === connectionId && Boolean(event.payload.ourDid)),
        timeout({ first: options.timeoutMs ?? 30_000 }),
      )

    const rotatedPromise = firstValueFrom(rotated$)
    const { newDid } = await connectionsApi.rotate({ connectionId })
    this.logger.debug(
      `[vt-flow] rotation initiated for connection ${connectionId} -> ${newDid}; awaiting ack`,
    )
    await rotatedPromise
    this.logger.debug(`[vt-flow] rotation acknowledged for connection ${connectionId}`)
    return { newDid }
  }
}
