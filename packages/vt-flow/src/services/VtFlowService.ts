import type { AgentContext, Logger, Query, QueryOptions } from '@credo-ts/core'
import type { DidCommCredentialExchangeRecord, DidCommInboundMessageContext } from '@credo-ts/didcomm'

import { CredoError, EventEmitter, InjectionSymbols, inject, injectable } from '@credo-ts/core'
import { DidCommCredentialState } from '@credo-ts/didcomm'

import { VtFlowConnectionState } from '../VtFlowConnectionState'
import { VtFlowEventTypes, type VtFlowStateChangedEvent } from '../VtFlowEvents'
import { VtFlowModuleConfig } from '../VtFlowModuleConfig'
import { VtFlowRole } from '../VtFlowRole'
import { VtFlowState } from '../VtFlowState'
import { VtFlowVariant } from '../VtFlowVariant'
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

export interface CreateValidationRequestParams {
  connectionId: string
  sessionUuid: string
  permId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
}

export interface CreateIssuanceRequestParams {
  connectionId: string
  sessionUuid: string
  schemaId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
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

/**
 * Core state machine for vt-flow. One method per state transition so the
 * caller can gate each on on-chain work. Methods return the wire message
 * without dispatching; dispatch lives in {@link VtFlowApi}.
 */
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

  // Applicant — outbound VR / IR

  /** Build the outbound `validation-request` and persist a §5.1 record in `VR_SENT`. */
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
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null, null)
    return { message, record }
  }

  /** Build the outbound `issuance-request` and persist a §5.2 record in `IR_SENT`. */
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
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null, null)
    return { message, record }
  }

  // Validator — inbound message processing

  /**
   * Create or re-attach (by `session_uuid`) a Validator-side record in
   * `AWAITING_VR` from an inbound `validation-request`.
   */
  public async processReceiveValidationRequest(
    messageContext: DidCommInboundMessageContext<ValidationRequestMessage>,
  ): Promise<VtFlowRecord> {
    const { message, agentContext } = messageContext
    const connection = messageContext.assertReadyConnection()

    // Reconnection: re-attach by `session_uuid`.
    const existing = await this.repository.findBySessionUuid(
      agentContext,
      message.sessionUuid,
      VtFlowRole.Validator,
    )
    if (existing) {
      existing.connectionId = connection.id
      existing.threadId = message.threadId
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
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null, null)
    return record
  }

  /** §5.2 counterpart of {@link processReceiveValidationRequest}. */
  public async processReceiveIssuanceRequest(
    messageContext: DidCommInboundMessageContext<IssuanceRequestMessage>,
  ): Promise<VtFlowRecord> {
    const { message, agentContext } = messageContext
    const connection = messageContext.assertReadyConnection()

    const existing = await this.repository.findBySessionUuid(
      agentContext,
      message.sessionUuid,
      VtFlowRole.Validator,
    )
    if (existing) {
      existing.connectionId = connection.id
      existing.threadId = message.threadId
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
    })

    await this.repository.save(agentContext, record)
    this.emitStateChanged(agentContext, record, null, null)
    return record
  }

  /** Applicant-side `oob-link`: transition to `OOB_PENDING`. */
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

  /** Applicant-side `validating`: informational, no state change. */
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

  /** Applicant-side `credential-state-change`. v1.0: `REVOKED` only. */
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

  // Validator — application-driven transitions

  /**
   * `AWAITING_VR => VALIDATING`. Caller is expected to have verified
   * `perm_id` / `agent_perm_id` / `wallet_agent_perm_id` on-chain.
   */
  public async acceptValidationRequest(agentContext: AgentContext, recordId: string): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState(VtFlowState.AwaitingVr)
    record.assertVariant(VtFlowVariant.ValidationProcess)

    await this.updateState(agentContext, record, VtFlowState.Validating)
    return record
  }

  /** §5.2: `AWAITING_IR => VALIDATING`. Transient before `CRED_OFFERED`. */
  public async acceptIssuanceRequest(agentContext: AgentContext, recordId: string): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState(VtFlowState.AwaitingIr)
    record.assertVariant(VtFlowVariant.DirectIssuance)

    await this.updateState(agentContext, record, VtFlowState.Validating)
    return record
  }

  /**
   * Reject with a problem-report. Transitions to `TERMINATED_BY_{role}`
   * and flips the connection state to `TERMINATED` if the error has
   * `impact: connection`.
   */
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

    await this.updateState(agentContext, record, nextState, {
      connectionState: VtFlowConnectionState.Terminated,
    })

    return { record, problemReport }
  }

  /** Applicant-side termination => `TERMINATED_BY_APPLICANT`. */
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

    await this.updateState(agentContext, record, VtFlowState.TerminatedByApplicant, {
      connectionState: VtFlowConnectionState.Terminated,
    })

    return { record, problemReport }
  }

  /** Build `oob-link`. Transitions non-terminal records to `OOB_PENDING`. */
  public async sendOobLinkForSession(
    agentContext: AgentContext,
    recordId: string,
    params: SendOobLinkParams,
  ): Promise<{ record: VtFlowRecord; message: OobLinkMessage }> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    // Valid from AWAITING_*, VALIDATING, or COMPLETED (re-validation).
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

  /** Build a `validating` informational message. No state change. */
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

  /** `VALIDATING => VALIDATED`. Call after `set-perm-vp-validated` on-chain. */
  public async markValidated(agentContext: AgentContext, recordId: string): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    record.assertState([VtFlowState.Validating, VtFlowState.OobPending])
    record.assertVariant(VtFlowVariant.ValidationProcess)

    await this.updateState(agentContext, record, VtFlowState.Validated)
    return record
  }

  /** Link a Credo exchange record and transition to `CRED_OFFERED`. */
  public async attachCredentialExchangeRecord(
    agentContext: AgentContext,
    recordId: string,
    credentialExchangeRecord: DidCommCredentialExchangeRecord,
  ): Promise<VtFlowRecord> {
    const record = await this.repository.getById(agentContext, recordId)
    record.assertRole(VtFlowRole.Validator)
    // Launching states: §5.1 VALIDATED, §5.2 VALIDATING, OOB_PENDING, or
    // COMPLETED (follow-up offer for revalidation/renewal).
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

  /** Build `credential-state-change`. Validator-side `COMPLETED => CRED_REVOKED`. */
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

  // Subprotocol correlation (Issue Credential V2 ↔ vt-flow)

  /** Map a Credo credential-exchange state change onto the vt-flow session. */
  public async onSubprotocolStateChanged(
    agentContext: AgentContext,
    record: VtFlowRecord,
    credentialExchangeRecord: DidCommCredentialExchangeRecord,
  ): Promise<void> {
    // Persist the linkage on first sighting (applicant learns of the
    // Credo record only when the offer arrives).
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
        // §5.1 has already moved to CRED_OFFERED via attachCredentialExchangeRecord;
        // only pick up the §5.2 tail here where state was VALIDATED.
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
        // Applicant must verify before Ack; Api layer drives the Ack.
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
          await this.updateState(agentContext, record, VtFlowState.Error, {
            connectionState: VtFlowConnectionState.Terminated,
          })
        }
        break
      default:
        break
    }
  }

  // Lookups

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

  // State transition primitives

  /** Transition, persist and emit `VtFlowStateChanged`. */
  public async updateState(
    agentContext: AgentContext,
    record: VtFlowRecord,
    newState: VtFlowState,
    options: { connectionState?: VtFlowConnectionState } = {},
  ): Promise<void> {
    const previousState = record.state
    const previousConnectionState = VtFlowConnectionState.Established
    const connectionState = options.connectionState ?? previousConnectionState

    if (previousState === newState && previousConnectionState === connectionState) {
      return
    }

    record.state = newState
    await this.repository.update(agentContext, record)

    this.emitStateChanged(agentContext, record, previousState, previousConnectionState, connectionState)
  }

  private emitStateChanged(
    agentContext: AgentContext,
    record: VtFlowRecord,
    previousState: VtFlowState | null,
    previousConnectionState: VtFlowConnectionState | null,
    connectionState: VtFlowConnectionState = VtFlowConnectionState.Established,
  ): void {
    this.eventEmitter.emit<VtFlowStateChangedEvent>(agentContext, {
      type: VtFlowEventTypes.VtFlowStateChanged,
      payload: {
        vtFlowRecordId: record.id,
        threadId: record.threadId,
        sessionUuid: record.sessionUuid,
        state: record.state,
        previousState,
        connectionState,
        previousConnectionState,
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
}
