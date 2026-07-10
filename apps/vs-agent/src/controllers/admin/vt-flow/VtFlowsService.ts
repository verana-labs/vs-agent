import type { VsAgent, VeranaChainService } from '@verana-labs/vs-agent-sdk'

import { CredoError } from '@credo-ts/core'
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  VtCredentialState,
  VtFlowApi,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
  isVtFlowTerminalState,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VeranaIndexerService, VtFlowOrchestrator } from '@verana-labs/vs-agent-sdk'

import { ADMIN_LOG_LEVEL, VERANA_INDEXER_BASE_URL } from '../../../config'
import { VsAgentService } from '../../../services/VsAgentService'
import { TsLogger } from '../../../utils'

import { ListFlowsQueryDto } from './dto/flow-requests.dto'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@Injectable()
export class VtFlowsService {
  private indexerService?: VeranaIndexerService

  public constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

  public async listFlows(query: ListFlowsQueryDto): Promise<VtFlowRecordDto[]> {
    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.resolveVtFlowApi(agent)
    const records = await vtFlowApi.findAllByQuery({
      ...(query.role && { role: query.role }),
      ...(query.flowState && { flowState: query.flowState }),
      ...(query.participant_id && { participantId: query.participant_id }),
      ...(query.schema_id && { schemaId: query.schema_id }),
      ...(query.participant_session_id && { participantSessionId: query.participant_session_id }),
    })

    const connectionIds = [...new Set(records.map(record => record.connectionId))]
    const connections = new Map(
      await Promise.all(
        connectionIds.map(async id => [id, await agent.didcomm.connections.findById(id)] as const),
      ),
    )

    const flows: VtFlowRecordDto[] = []
    for (const record of records) {
      const connection = connections.get(record.connectionId)
      const connectionState =
        isVtFlowTerminalState(record.state) || !connection
          ? 'TERMINATED'
          : connection.isReady
            ? 'ESTABLISHED'
            : 'NOT_CONNECTED'
      if (query.peerDID && connection?.theirDid !== query.peerDID) continue
      if (query.connectionState && connectionState !== query.connectionState) continue
      flows.push({ ...toDto(record, connection?.theirDid), connectionState })
    }
    return flows
  }

  public editCredentialClaims(
    participantSessionId: string,
    claims: Record<string, unknown>,
  ): Promise<VtFlowRecordDto> {
    return this.mutateFlow(participantSessionId, async ({ agent, vtFlowApi, record }) => {
      await this.assertConnectionEstablished(agent, record)
      return vtFlowApi.updateClaims(record.id, claims)
    })
  }

  public sendOobLink(participantSessionId: string, url: string, message?: string): Promise<VtFlowRecordDto> {
    return this.mutateFlow(participantSessionId, async ({ agent, vtFlowApi, record }) => {
      await this.assertConnectionEstablished(agent, record)
      return vtFlowApi.sendOobLink({ vtFlowRecordId: record.id, url, description: message ?? '' })
    })
  }

  public revokeCredential(participantSessionId: string, reason?: string): Promise<VtFlowRecordDto> {
    return this.mutateFlow(participantSessionId, ({ vtFlowApi, record }) =>
      vtFlowApi.notifyCredentialStateChange({
        vtFlowRecordId: record.id,
        state: VtCredentialState.Revoked,
        reason,
      }),
    )
  }

  private async mutateFlow(
    participantSessionId: string,
    action: (ctx: { agent: VsAgent; vtFlowApi: VtFlowApi; record: VtFlowRecord }) => Promise<VtFlowRecord>,
  ): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await this.findRecordBySession(vtFlowApi, participantSessionId)
    try {
      return toDto(await action({ agent, vtFlowApi, record }))
    } catch (error) {
      if (error instanceof CredoError) throw new BadRequestException(error.message)
      throw error
    }
  }

  private async assertConnectionEstablished(agent: VsAgent, record: VtFlowRecord): Promise<void> {
    const connection = await agent.didcomm.connections.findById(record.connectionId)
    if (!connection?.isReady) {
      throw new BadRequestException('Flow connection is not in ESTABLISHED state')
    }
  }

  public async validateAndOfferCredential(participantSessionId: string): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    this.requireChain(agent)

    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await this.findRecordBySession(vtFlowApi, participantSessionId)
    if (record.role !== VtFlowRole.Validator) {
      throw new BadRequestException('This record is applicant-side; validate is a validator action')
    }
    if (record.variant !== VtFlowVariant.OnboardingProcess) {
      throw new BadRequestException(
        `This record is variant '${record.variant}'; validate only applies to OnboardingProcess`,
      )
    }
    if (record.state !== VtFlowState.AwaitingOr) {
      throw new BadRequestException(`Record state is '${record.state}', expected '${VtFlowState.AwaitingOr}'`)
    }
    if (!record.participantId) throw new BadRequestException('Record has no participantId')

    const holderParticipant = await this.getIndexer().getParticipant(Number(record.participantId))
    if (!holderParticipant)
      throw new BadRequestException(`Holder participant ${record.participantId} not found on indexer`)
    if (holderParticipant.schema_id == null)
      throw new BadRequestException('Holder participant has no schema_id')

    const orchestrator = new VtFlowOrchestrator(agent, { publicApiBaseUrl: agent.publicApiBaseUrl })
    try {
      const offered = await orchestrator.validateAndOfferCredential({
        vtFlowRecordId: record.id,
        credentialSchemaId: String(holderParticipant.schema_id),
      })
      return toDto(offered)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new HttpException(`validate failed: ${message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  private resolveVtFlowApi(agent: VsAgent): VtFlowApi {
    return agent.dependencyManager.resolve(VtFlowApi)
  }

  private async findRecordBySession(
    vtFlowApi: VtFlowApi,
    participantSessionId: string,
  ): Promise<VtFlowRecord> {
    const [record] = await vtFlowApi.findAllByQuery({ participantSessionId })
    if (!record)
      throw new NotFoundException(`No vt-flow for participant_session_id '${participantSessionId}'`)
    return record
  }

  private requireChain(agent: VsAgent): VeranaChainService {
    if (!agent.veranaChain) {
      throw new BadRequestException(
        'Agent is not connected to Verana chain (set VERANA_RPC_ENDPOINT_URL and VERANA_ACCOUNT_MNEMONIC)',
      )
    }
    return agent.veranaChain
  }

  private getIndexer(): VeranaIndexerService {
    if (!this.indexerService) {
      if (!VERANA_INDEXER_BASE_URL) {
        throw new BadRequestException(
          'Indexer not configured (set VERANA_INDEXER_BASE_URL); required for vt-flow',
        )
      }
      this.indexerService = new VeranaIndexerService({
        baseUrl: VERANA_INDEXER_BASE_URL,
        logger: new TsLogger(ADMIN_LOG_LEVEL, 'VeranaIndexer'),
      })
    }
    return this.indexerService
  }
}

function toDto(record: VtFlowRecord, peerDid?: string): VtFlowRecordDto {
  return {
    peerDid,
    oobLinkUrl: record.oobLinkUrl,
    id: record.id,
    threadId: record.threadId,
    participantSessionId: record.participantSessionId,
    connectionId: record.connectionId,
    role: record.role,
    variant: record.variant,
    state: record.state,
    agentParticipantId: record.agentParticipantId,
    walletAgentParticipantId: record.walletAgentParticipantId,
    participantId: record.participantId,
    schemaId: record.schemaId,
    claims: record.claims,
    credentialExchangeRecordId: record.credentialExchangeRecordId,
    subprotocolThid: record.subprotocolThid,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}
