import type { VtFlowErrorCode } from './errors'
import type { VtFlowRecord } from './repository'
import type { Query, QueryOptions } from '@credo-ts/core'
import type { DidCommCredentialExchangeRecord, DidCommCredentialProtocol } from '@credo-ts/didcomm'

import { AgentContext, CredoError, injectable, utils } from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommConnectionService,
  DidCommCredentialExchangeRepository,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  subprotocolThid?: string
  reason?: string
}

/** Public API for vt-flow; each method performs a single state transition so callers can gate each one on its own on-chain work. */
@injectable()
export class VtFlowApi {
  public constructor(
    private readonly vtFlowService: VtFlowService,
    private readonly messageSender: DidCommMessageSender,
    private readonly connectionService: DidCommConnectionService,
    private readonly agentContext: AgentContext,
    private readonly config: VtFlowModuleConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly credentialsModuleConfig: DidCommCredentialsModuleConfig<any>,
    private readonly credentialExchangeRepository: DidCommCredentialExchangeRepository,
  ) {
    void this.config
  }

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

  public acceptValidationRequest(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.acceptValidationRequest(this.agentContext, vtFlowRecordId)
  }

  public acceptIssuanceRequest(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.acceptIssuanceRequest(this.agentContext, vtFlowRecordId)
  }

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

  public markValidated(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.markValidated(this.agentContext, vtFlowRecordId)
  }

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

  private resolveCredentialV2Protocol(): DidCommCredentialProtocol & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createOffer: (agentContext: AgentContext, options: any) => Promise<any>
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveCredentialsApi(): any {
    return this.agentContext.dependencyManager.resolve(DidCommCredentialsApi)
  }

  private async dispatchMessage(
    connectionId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
