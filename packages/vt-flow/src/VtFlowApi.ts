import type { VtFlowErrorCode } from './errors'
import type { VtFlowRecord } from './repository'
import type { Query, QueryOptions } from '@credo-ts/core'
import type { DidCommCredentialExchangeRecord, DidCommCredentialProtocol } from '@credo-ts/didcomm'

import { AgentContext, CredoError, injectable, utils } from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommConnectionService,
  DidCommCredentialExchangeRepository,
  // biome-ignore lint/correctness/noUnusedImports: used as a DI token at runtime
  DidCommCredentialsApi,
  DidCommCredentialsModuleConfig,
  DidCommMessageSender,
  getOutboundDidCommMessageContext,
} from '@credo-ts/didcomm'

import { VtFlowModuleConfig } from './VtFlowModuleConfig'
import { VtFlowRole } from './VtFlowRole'
import { VtCredentialState } from './messages'
import { VtFlowService } from './services'

export interface SendValidationRequestOptions {
  connectionId: string
  /** Defaults to a fresh UUIDv4. */
  sessionUuid?: string
  permId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
}

export interface SendIssuanceRequestOptions {
  connectionId: string
  sessionUuid?: string
  schemaId: string
  agentPermId: string
  walletAgentPermId: string
  claims?: Record<string, unknown>
}

export interface OfferCredentialForSessionOptions {
  vtFlowRecordId: string
  /** Passed through to DidCommCredentialV2Protocol.createOffer. */
  // biome-ignore lint/suspicious/noExplicitAny: format payload depends on host agent registrations.
  credentialFormats: any
  comment?: string
  goal?: string
  goalCode?: string
}

export interface SendOobLinkOptions {
  vtFlowRecordId: string
  url: string
  description: string
  expiresTime?: Date
}

export interface ProblemReportDispatchOptions {
  vtFlowRecordId: string
  code: VtFlowErrorCode
  enDescription?: string
  fixHintEn?: string
}

export interface NotifyCredentialStateChangeOptions {
  vtFlowRecordId: string
  state: VtCredentialState | string
  /** Defaults to the record's captured `subprotocolThid`. */
  subprotocolThid?: string
  reason?: string
}

/**
 * Public API for vt-flow. Each method performs a single state transition
 * so the caller can gate each one on its own on-chain work.
 */
@injectable()
export class VtFlowApi {
  public constructor(
    private readonly vtFlowService: VtFlowService,
    private readonly messageSender: DidCommMessageSender,
    private readonly connectionService: DidCommConnectionService,
    private readonly agentContext: AgentContext,
    private readonly config: VtFlowModuleConfig,
    // biome-ignore lint/suspicious/noExplicitAny: vt-flow is credential-format-agnostic
    private readonly credentialsModuleConfig: DidCommCredentialsModuleConfig<any>,
    private readonly credentialExchangeRepository: DidCommCredentialExchangeRepository,
  ) {
    void this.config
  }

  // Applicant — send side

  /** Open a §5.1 Validation Process session. */
  public async sendValidationRequest(options: SendValidationRequestOptions): Promise<VtFlowRecord> {
    const connection = await this.connectionService.getById(this.agentContext, options.connectionId)
    connection.assertReady()

    const sessionUuid = options.sessionUuid ?? utils.uuid()

    const { message, record } = await this.vtFlowService.createValidationProcessRecord(this.agentContext, {
      connectionId: options.connectionId,
      sessionUuid,
      permId: options.permId,
      agentPermId: options.agentPermId,
      walletAgentPermId: options.walletAgentPermId,
      claims: options.claims,
    })

    const outboundMessageContext = await getOutboundDidCommMessageContext(this.agentContext, {
      message,
      associatedRecord: record,
      connectionRecord: connection,
    })
    await this.messageSender.sendMessage(outboundMessageContext)

    return record
  }

  /** Open a §5.2 Direct Issuance session. */
  public async sendIssuanceRequest(options: SendIssuanceRequestOptions): Promise<VtFlowRecord> {
    const connection = await this.connectionService.getById(this.agentContext, options.connectionId)
    connection.assertReady()

    const sessionUuid = options.sessionUuid ?? utils.uuid()

    const { message, record } = await this.vtFlowService.createDirectIssuanceRecord(this.agentContext, {
      connectionId: options.connectionId,
      sessionUuid,
      schemaId: options.schemaId,
      agentPermId: options.agentPermId,
      walletAgentPermId: options.walletAgentPermId,
      claims: options.claims,
    })

    const outboundMessageContext = await getOutboundDidCommMessageContext(this.agentContext, {
      message,
      associatedRecord: record,
      connectionRecord: connection,
    })
    await this.messageSender.sendMessage(outboundMessageContext)

    return record
  }

  /**
   * Ack the received credential. Applicant side; advances vt-flow to
   * COMPLETED once the subprotocol reaches `done`.
   */
  public async acceptReceivedCredential(vtFlowRecordId: string): Promise<VtFlowRecord> {
    const record = await this.vtFlowService.getById(this.agentContext, vtFlowRecordId)
    record.assertRole(VtFlowRole.Applicant)

    if (!record.credentialExchangeRecordId) {
      throw new CredoError(
        `VtFlow record '${record.id}' has no linked credentialExchangeRecordId — did an offer arrive?`,
      )
    }

    const credentialsApi = this.resolveCredentialsApi()
    await credentialsApi.acceptCredential({
      credentialExchangeRecordId: record.credentialExchangeRecordId,
    })
    return record
  }

  /** Applicant-side termination. Sends a problem-report. */
  public async terminateSession(options: ProblemReportDispatchOptions): Promise<VtFlowRecord> {
    const { record, problemReport } = await this.vtFlowService.terminateByApplicant(
      this.agentContext,
      options.vtFlowRecordId,
      {
        code: options.code,
        enDescription: options.enDescription,
        fixHintEn: options.fixHintEn,
      },
    )
    await this.dispatchMessage(record.connectionId, problemReport, record)
    return record
  }

  // Validator — accept / reject / oob / validating / validated / offer

  /** AWAITING_VR => VALIDATING. */
  public acceptValidationRequest(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.acceptValidationRequest(this.agentContext, vtFlowRecordId)
  }

  /** AWAITING_IR => VALIDATING (§5.2). */
  public acceptIssuanceRequest(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.acceptIssuanceRequest(this.agentContext, vtFlowRecordId)
  }

  /** Reject the session with a problem-report and transition to the terminal state. */
  public async rejectRequest(options: ProblemReportDispatchOptions): Promise<VtFlowRecord> {
    const { record, problemReport } = await this.vtFlowService.rejectRequest(
      this.agentContext,
      options.vtFlowRecordId,
      {
        code: options.code,
        enDescription: options.enDescription,
        fixHintEn: options.fixHintEn,
      },
    )
    await this.dispatchMessage(record.connectionId, problemReport, record)
    return record
  }

  /** Send an `oob-link`. Transitions Validator record to `OOB_PENDING`. */
  public async sendOobLink(options: SendOobLinkOptions): Promise<VtFlowRecord> {
    const { record, message } = await this.vtFlowService.sendOobLinkForSession(
      this.agentContext,
      options.vtFlowRecordId,
      {
        url: options.url,
        description: options.description,
        expiresTime: options.expiresTime,
      },
    )
    await this.dispatchMessage(record.connectionId, message, record)
    return record
  }

  /** Send an informational `validating` message. No state change. */
  public async sendValidating(
    vtFlowRecordId: string,
    options: { comment?: string } = {},
  ): Promise<VtFlowRecord> {
    const { record, message } = await this.vtFlowService.sendValidatingForSession(
      this.agentContext,
      vtFlowRecordId,
      options,
    )
    await this.dispatchMessage(record.connectionId, message, record)
    return record
  }

  /** VALIDATING => VALIDATED. Call after `set-perm-vp-validated` succeeds on-chain. */
  public markValidated(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.markValidated(this.agentContext, vtFlowRecordId)
  }

  /**
   * Send an `offer-credential` bound to this session via `~thread.pthid`.
   * Subprotocol is configured with `autoAcceptCredential: Never`; the
   * Applicant must Ack via {@link acceptReceivedCredential}.
   */
  public async offerCredentialForSession(
    options: OfferCredentialForSessionOptions,
  ): Promise<{ record: VtFlowRecord; credentialExchangeRecord: DidCommCredentialExchangeRecord }> {
    const record = await this.vtFlowService.getById(this.agentContext, options.vtFlowRecordId)
    record.assertRole(VtFlowRole.Validator)

    const connection = await this.connectionService.getById(this.agentContext, record.connectionId)
    connection.assertReady()

    const v2Protocol = this.resolveCredentialV2Protocol()

    const { credentialExchangeRecord, message } = await v2Protocol.createOffer(this.agentContext, {
      connectionRecord: connection,
      credentialFormats: options.credentialFormats,
      autoAcceptCredential: DidCommAutoAcceptCredential.Never,
      comment: options.comment,
      goal: options.goal,
      goalCode: options.goalCode,
    })

    // Stamp the parent thread on both the record and the outbound message
    // so inbound credential events correlate to this vt-flow session.
    credentialExchangeRecord.parentThreadId = record.threadId
    await this.credentialExchangeRepository.update(this.agentContext, credentialExchangeRecord)

    message.setThread({
      threadId: credentialExchangeRecord.threadId,
      parentThreadId: record.threadId,
    })

    const outboundMessageContext = await getOutboundDidCommMessageContext(this.agentContext, {
      message,
      associatedRecord: credentialExchangeRecord,
      connectionRecord: connection,
    })
    await this.messageSender.sendMessage(outboundMessageContext)

    await this.vtFlowService.attachCredentialExchangeRecord(
      this.agentContext,
      record.id,
      credentialExchangeRecord,
    )

    return {
      record: await this.vtFlowService.getById(this.agentContext, record.id),
      credentialExchangeRecord,
    }
  }

  /** Send a post-issuance `credential-state-change` (v1.0: `REVOKED`). */
  public async notifyCredentialStateChange(
    options: NotifyCredentialStateChangeOptions,
  ): Promise<VtFlowRecord> {
    const existing = await this.vtFlowService.getById(this.agentContext, options.vtFlowRecordId)
    const subprotocolThid = options.subprotocolThid ?? existing.subprotocolThid
    if (!subprotocolThid) {
      throw new CredoError(
        `VtFlow record '${existing.id}' has no subprotocolThid; cannot notify credential-state-change.`,
      )
    }

    const { record, message } = await this.vtFlowService.notifyCredentialStateChange(
      this.agentContext,
      options.vtFlowRecordId,
      {
        state: options.state,
        subprotocolThid,
        reason: options.reason,
      },
    )

    await this.dispatchMessage(record.connectionId, message, record)
    return record
  }

  // Lookups

  public getById(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.getById(this.agentContext, vtFlowRecordId)
  }

  public findById(vtFlowRecordId: string): Promise<VtFlowRecord | null> {
    return this.vtFlowService.findById(this.agentContext, vtFlowRecordId)
  }

  public getByThreadId(threadId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.getByThreadId(this.agentContext, threadId)
  }

  public findByThreadId(threadId: string): Promise<VtFlowRecord | null> {
    return this.vtFlowService.findByThreadId(this.agentContext, threadId)
  }

  public findAllByQuery(query: Query<VtFlowRecord>, queryOptions?: QueryOptions): Promise<VtFlowRecord[]> {
    return this.vtFlowService.findAllByQuery(this.agentContext, query, queryOptions)
  }

  // Internal helpers

  /** Credo doesn't register V2Protocol as a standalone DI token; pull it from config. */
  private resolveCredentialV2Protocol(): DidCommCredentialProtocol & {
    // biome-ignore lint/suspicious/noExplicitAny: format-agnostic offer payload
    createOffer: (agentContext: AgentContext, options: any) => Promise<any>
  } {
    const protocols = this.credentialsModuleConfig.credentialProtocols
    const v2 = protocols.find((p: DidCommCredentialProtocol) => p.version === 'v2')
    if (!v2) {
      throw new CredoError(
        'DidCommCredentialV2Protocol is not registered on the agent. vt-flow requires it for Issue Credential V2 offers.',
      )
    }
    return v2 as DidCommCredentialProtocol & {
      // biome-ignore lint/suspicious/noExplicitAny: see above
      createOffer: (agentContext: AgentContext, options: any) => Promise<any>
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Api generics depend on host agent format services.
  private resolveCredentialsApi(): any {
    return this.agentContext.dependencyManager.resolve(DidCommCredentialsApi)
  }

  private async dispatchMessage(
    connectionId: string,
    // biome-ignore lint/suspicious/noExplicitAny: any DidCommMessage subclass
    message: any,
    associatedRecord: VtFlowRecord,
  ): Promise<void> {
    const connection = await this.connectionService.getById(this.agentContext, connectionId)
    const outbound = await getOutboundDidCommMessageContext(this.agentContext, {
      message,
      associatedRecord,
      connectionRecord: connection,
    })
    await this.messageSender.sendMessage(outbound)
  }
}
