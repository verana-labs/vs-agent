import type { VtFlowRecord } from './repository'
import type {
  NotifyCredentialStateChangeOptions,
  OfferCredentialForSessionOptions,
  ProblemReportDispatchOptions,
  SendIssuanceRequestOptions,
  ResendOnboardingRequestOptions,
  SendOnboardingRequestOptions,
  SendOobLinkOptions,
  VtFlowValidation,
} from './types'
import type { Query, QueryOptions } from '@credo-ts/core'
import type {
  DataIntegrityCredential,
  DidCommCredentialExchangeRecord,
  DidCommCredentialProtocol,
  DidCommDataIntegrityAcceptRequestFormat,
  DidCommMessage,
} from '@credo-ts/didcomm'

import { AgentContext, CredoError, injectable, utils } from '@credo-ts/core'
import {
  DidCommAutoAcceptCredential,
  DidCommConnectionService,
  DidCommCredentialExchangeRepository,
  DidCommCredentialState,
  DidCommCredentialsApi,
  DidCommCredentialsModuleConfig,
  DidCommMessageSender,
  getOutboundDidCommMessageContext,
} from '@credo-ts/didcomm'

import { VtFlowModuleConfig } from './VtFlowModuleConfig'
import { VtFlowErrorCode } from './errors'
import { VtFlowService } from './services'
import { VtFlowRole, VtFlowState, VtFlowTxStatus } from './types'

/** Public API for vt-flow; each method performs a single state transition so callers can gate each one on its own on-chain work. */
@injectable()
export class VtFlowApi {
  public constructor(
    private readonly vtFlowService: VtFlowService,
    private readonly messageSender: DidCommMessageSender,
    private readonly connectionService: DidCommConnectionService,
    private readonly agentContext: AgentContext,
    private readonly config: VtFlowModuleConfig,
    private readonly credentialsModuleConfig: DidCommCredentialsModuleConfig<DidCommCredentialProtocol[]>,
    private readonly credentialExchangeRepository: DidCommCredentialExchangeRepository,
  ) {}

  public async sendOnboardingRequest(options: SendOnboardingRequestOptions): Promise<VtFlowRecord> {
    const connection = await this.connectionService.getById(this.agentContext, options.connectionId)
    connection.assertReady()
    await this.vtFlowService.checkIsVerifiableService(this.agentContext, connection)

    const participantSessionId = options.participantSessionId ?? utils.uuid()

    const { message, record } = await this.vtFlowService.createOnboardingProcessRecord(this.agentContext, {
      connectionId: options.connectionId,
      participantSessionId,
      applicantParticipantId: options.applicantParticipantId,
      applicantParticipantRole: options.applicantParticipantRole,
      validatorParticipantId: options.validatorParticipantId,
      schemaId: options.schemaId,
      agentParticipantId: options.agentParticipantId,
      walletAgentParticipantId: options.walletAgentParticipantId,
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

  public async resendOnboardingRequest(options: ResendOnboardingRequestOptions): Promise<VtFlowRecord> {
    const connection = await this.connectionService.getById(this.agentContext, options.connectionId)
    connection.assertReady()
    await this.vtFlowService.checkIsVerifiableService(this.agentContext, connection)

    const { message, record } = await this.vtFlowService.reattachOnboardingProcessRecord(this.agentContext, {
      vtFlowRecordId: options.vtFlowRecordId,
      connectionId: options.connectionId,
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
    await this.vtFlowService.checkIsVerifiableService(this.agentContext, connection)

    const participantSessionId = options.participantSessionId ?? utils.uuid()

    const { message, record } = await this.vtFlowService.createDirectIssuanceRecord(this.agentContext, {
      connectionId: options.connectionId,
      participantSessionId,
      schemaId: options.schemaId,
      agentParticipantId: options.agentParticipantId,
      walletAgentParticipantId: options.walletAgentParticipantId,
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

    const credentialsApi = this.agentContext.dependencyManager.resolve(DidCommCredentialsApi)
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

  public async terminateSessionAsValidator(options: ProblemReportDispatchOptions): Promise<VtFlowRecord> {
    const { record, problemReport } = await this.vtFlowService.terminateByValidator(
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

  public async terminateByChainEvent(options: {
    vtFlowRecordId: string
    code: VtFlowErrorCode
    state: VtFlowState.ParticipantRevoked | VtFlowState.ParticipantSlashed
    enDescription?: string
  }): Promise<VtFlowRecord> {
    const { record, problemReport } = await this.vtFlowService.terminateByChainEvent(
      this.agentContext,
      options.vtFlowRecordId,
      { code: options.code, state: options.state, enDescription: options.enDescription },
    )
    try {
      await this.dispatchMessage(record.connectionId, problemReport, record)
    } catch (e) {
      this.agentContext.config.logger.warn(
        `[VtFlow] problem-report dispatch failed for ${record.id}: ${(e as Error).message}`,
      )
    }
    return record
  }

  public async acceptOnboardingRequest(vtFlowRecordId: string): Promise<VtFlowRecord> {
    const { record, message } = await this.vtFlowService.acceptOnboardingRequest(
      this.agentContext,
      vtFlowRecordId,
    )
    await this.dispatchMessage(record.connectionId, message, record)
    return record
  }

  public async acceptIssuanceRequest(vtFlowRecordId: string): Promise<VtFlowRecord> {
    const { record, message } = await this.vtFlowService.acceptIssuanceRequest(
      this.agentContext,
      vtFlowRecordId,
    )
    await this.dispatchMessage(record.connectionId, message, record)
    return record
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

  public recordValidation(
    vtFlowRecordId: string,
    validation: VtFlowValidation,
    state?: VtFlowState,
  ): Promise<VtFlowRecord> {
    return this.vtFlowService.recordValidation(this.agentContext, vtFlowRecordId, validation, state)
  }

  public markValidated(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.markValidated(this.agentContext, vtFlowRecordId)
  }

  public markPendingClaims(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.markPendingClaims(this.agentContext, vtFlowRecordId)
  }

  public markCompleted(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.vtFlowService.markCompleted(this.agentContext, vtFlowRecordId)
  }

  public async offerCredentialForSession(
    options: OfferCredentialForSessionOptions,
  ): Promise<{ record: VtFlowRecord; credentialExchangeRecord: DidCommCredentialExchangeRecord }> {
    const record = await this.vtFlowService.getById(this.agentContext, options.vtFlowRecordId)
    this.vtFlowService.assertCanOfferCredential(record)

    const connection = await this.connectionService.getById(this.agentContext, record.connectionId)
    connection.assertReady()

    const v2Protocol = this.credentialsModuleConfig.credentialProtocols.find(p => p.version === 'v2')
    if (!v2Protocol) {
      throw new CredoError(
        'DidCommCredentialV2Protocol is not registered on the agent. vt-flow requires it for Issue Credential V2 offers.',
      )
    }

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
      options.credentialDigest,
      options.issuerParticipantId,
    )

    return {
      record: await this.vtFlowService.getById(this.agentContext, record.id),
      credentialExchangeRecord,
    }
  }

  /**
   * The spec forbids delivering a credential whose digest is not anchored, so a throwing hook must abort.
   *
   * RFC 0809 leaves the cryptosuite of a VC Data Model 2.0 credential to the issuer, so it is not
   * negotiated with the applicant: the module `dataIntegrityCryptosuite` applies unless the caller
   * passes its own `credentialFormats`.
   */
  public async issueCredentialForSession(options: {
    vtFlowRecordId: string
    credentialExchangeRecordId: string
    comment?: string
    credentialFormats?: { dataIntegrity: DidCommDataIntegrityAcceptRequestFormat }
  }): Promise<{ record: VtFlowRecord; credentialExchangeRecord: DidCommCredentialExchangeRecord }> {
    const record = await this.vtFlowService.getById(this.agentContext, options.vtFlowRecordId)
    record.assertRole(VtFlowRole.Validator)

    const credentialExchangeRecord = await this.credentialExchangeRepository.getById(
      this.agentContext,
      options.credentialExchangeRecordId,
    )
    const protocol = this.credentialsModuleConfig.credentialProtocols.find(
      p => p.version === credentialExchangeRecord.protocolVersion,
    )
    if (!protocol) {
      throw new CredoError(
        `No credential protocol registered for version '${credentialExchangeRecord.protocolVersion}'`,
      )
    }

    const connectionRecord = credentialExchangeRecord.connectionId
      ? await this.connectionService.getById(this.agentContext, credentialExchangeRecord.connectionId)
      : undefined
    connectionRecord?.assertReady()

    // a credential signed by an earlier call whose anchoring failed is delivered as it was signed
    const reissue = credentialExchangeRecord.state === DidCommCredentialState.CredentialIssued
    const storedMessage = reissue
      ? await protocol.findCredentialMessage(this.agentContext, credentialExchangeRecord.id)
      : null
    if (reissue && !storedMessage) {
      throw new CredoError(`Credential exchange '${credentialExchangeRecord.id}' has no issued credential`)
    }
    // unlike DidCommCredentialsApi.acceptRequest, this signs without sending
    const message =
      storedMessage ??
      (
        await protocol.acceptRequest(this.agentContext, {
          credentialExchangeRecord,
          comment: options.comment,
          credentialFormats: options.credentialFormats ?? {
            dataIntegrity: { cryptosuite: this.config.dataIntegrityCryptosuite },
          },
        })
      ).message

    const hook = this.config.onBeforeCredentialIssued
    if (hook) {
      const formatData = await protocol.getFormatData(this.agentContext, credentialExchangeRecord.id)
      // the attachment, which is the exact JSON the holder will digest
      const credential = (formatData.credential as { dataIntegrity?: DataIntegrityCredential } | undefined)
        ?.dataIntegrity?.credential
      if (!credential) {
        throw new CredoError(
          `Issued credential for '${credentialExchangeRecord.id}' has no data integrity credential body to anchor`,
        )
      }
      const result = await hook({
        agentContext: this.agentContext,
        record,
        credentialExchangeRecord,
        credential,
      })
      if (result?.issuance) {
        await this.vtFlowService.recordIssuance(this.agentContext, record.id, result.issuance)
      }
      if (result?.issuance?.tx?.status === VtFlowTxStatus.Failed) {
        return {
          record: await this.vtFlowService.getById(this.agentContext, record.id),
          credentialExchangeRecord,
        }
      }
      if (result?.credentialDigest) {
        await this.vtFlowService.setCredentialDigest(this.agentContext, record.id, result.credentialDigest)
      }
    }

    const outboundMessageContext = await getOutboundDidCommMessageContext(this.agentContext, {
      message,
      connectionRecord,
      associatedRecord: credentialExchangeRecord,
    })
    await this.messageSender.sendMessage(outboundMessageContext)

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

  public setEcsSchemaKey(vtFlowRecordId: string, ecsSchemaKey: string): Promise<VtFlowRecord> {
    return this.vtFlowService.setEcsSchemaKey(this.agentContext, vtFlowRecordId, ecsSchemaKey)
  }

  public updateClaims(vtFlowRecordId: string, claims: Record<string, unknown>): Promise<VtFlowRecord> {
    return this.vtFlowService.updateClaims(this.agentContext, vtFlowRecordId, claims)
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

  private async dispatchMessage(
    connectionId: string,
    message: DidCommMessage,
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
