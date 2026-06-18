import type { VsAgent, VeranaChainService } from '@verana-labs/vs-agent-sdk'

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  VtFlowApi,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { VeranaIndexerService, VtFlowOrchestrator } from '@verana-labs/vs-agent-sdk'

import { ADMIN_LOG_LEVEL, VERANA_INDEXER_BASE_URL } from '../../../config'
import { VsAgentService } from '../../../services/VsAgentService'
import { TsLogger } from '../../../utils'

import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@Injectable()
export class VtFlowsService {
  private indexerService?: VeranaIndexerService

  public constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

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
    if (!record.participantId) throw new BadRequestException('Record has no permId')

    const holderPerm = await this.getIndexer().getPermission(Number(record.participantId))
    if (!holderPerm)
      throw new BadRequestException(`Holder permission ${record.participantId} not found on indexer`)
    if (holderPerm.schema_id == null) throw new BadRequestException('Holder permission has no schema_id')

    const orchestrator = new VtFlowOrchestrator(agent, { publicApiBaseUrl: agent.publicApiBaseUrl })
    try {
      const offered = await orchestrator.validateAndOfferCredential({
        vtFlowRecordId: record.id,
        credentialSchemaId: String(holderPerm.schema_id),
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

function toDto(record: VtFlowRecord): VtFlowRecordDto {
  return {
    vtFlowRecordId: record.id,
    threadId: record.threadId,
    sessionUuid: record.participantSessionId,
    connectionId: record.connectionId,
    role: record.role,
    variant: record.variant,
    state: record.state,
    agentPermId: record.agentParticipantId,
    walletAgentPermId: record.walletAgentParticipantId,
    permId: record.participantId,
    schemaId: record.schemaId,
    claims: record.claims,
    credentialExchangeRecordId: record.credentialExchangeRecordId,
    subprotocolThid: record.subprotocolThid,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}
