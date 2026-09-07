import type { VsAgent, VeranaChainService } from '@verana-labs/vs-agent-sdk'

import { CredoError } from '@credo-ts/core'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'
import {
  BadRequestException,
  ConflictException,
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
import { HOLDER_PARTICIPANT_TYPE, VtFlowOrchestrator } from '@verana-labs/vs-agent-sdk'

import { AdminApiError, AdminApiErrorCode, createdAtKey, Page, paginate } from '../../../common'
import { VsAgentService } from '../../../services/VsAgentService'
import { V2VtFlowRecordDto, VtConnectionState } from '../v2/vt/dto'
import { CredentialTypesService } from '../credentials/CredentialTypeService'

import { ListFlowsQueryDto, ListFlowsV2QueryDto } from './dto/flow-requests.dto'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@Injectable()
export class VtFlowsService {
  public constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject(CredentialTypesService) private readonly credentialTypesService: CredentialTypesService,
  ) {}

  public async listFlows(query: ListFlowsQueryDto): Promise<VtFlowRecordDto[]> {
    const flows = await this.collectFlows({
      role: query.role,
      connectionState: query.connectionState,
      flowState: query.flowState,
      peerDid: query.peerDID,
      participantId: query.participant_id,
      schemaId: query.schema_id,
      participantSessionId: query.participant_session_id,
    })
    return flows.map(toDto)
  }

  public async listFlowsPage(query: ListFlowsV2QueryDto): Promise<Page<V2VtFlowRecordDto>> {
    const flows = await this.collectFlows(query)
    return paginate(
      flows.map(flow => toV2Dto(toDto(flow))),
      query,
      {
        method: 'listFlows',
        filters: {
          role: query.role,
          connectionState: query.connectionState,
          flowState: query.flowState,
          peerDid: query.peerDid,
          participantId: query.participantId,
          schemaId: query.schemaId,
          participantSessionId: query.participantSessionId,
        },
      },
      createdAtKey,
    )
  }

  public async getFlow(participantSessionId: string): Promise<V2VtFlowRecordDto> {
    const [flow] = await this.collectFlows({ participantSessionId })
    if (!flow) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        `no vt-flow with participantSessionId "${participantSessionId}"`,
      )
    }
    return toV2Dto(toDto(flow))
  }

  /**
   * Finds the flows that match the query and resolves the Connection State and the peer DID of
   * each one. The connection filters apply here, because the flow record does not hold the
   * connection data.
   */
  private async collectFlows(query: FlowFilters): Promise<ResolvedFlow[]> {
    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.resolveVtFlowApi(agent)
    const validatorScope = query.role === VtFlowRole.Applicant && query.participantId
    let records = await vtFlowApi.findAllByQuery({
      ...(query.role && { role: query.role }),
      ...(query.flowState && { flowState: query.flowState }),
      ...(query.participantId && !validatorScope && { participantId: query.participantId }),
      ...(query.schemaId && { schemaId: query.schemaId }),
      ...(query.participantSessionId && { participantSessionId: query.participantSessionId }),
    })
    if (validatorScope) {
      records = await this.filterByValidatorParticipant(agent, records, query.participantId!)
    }

    const connectionIds = [...new Set(records.map(record => record.connectionId))]
    const connections = new Map(
      await Promise.all(
        connectionIds.map(async id => [id, await agent.didcomm.connections.findById(id)] as const),
      ),
    )

    const flows: ResolvedFlow[] = []
    for (const record of records) {
      const connection = connections.get(record.connectionId)
      const connectionState = connectionStateOf(record, connection)
      if (query.peerDid && connection?.theirDid !== query.peerDid) continue
      if (query.connectionState && connectionState !== query.connectionState) continue
      flows.push({ record, peerDid: connection?.theirDid, connectionState })
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
      return vtFlowApi.sendOobLink({
        vtFlowRecordId: record.id,
        url,
        description: message ?? '',
      })
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

  public revokeFlowCredential(participantSessionId: string, reason?: string): Promise<VtFlowRecordDto> {
    return this.mutateFlow(participantSessionId, async ({ agent, vtFlowApi, record }) => {
      await this.revokeIssuedCredential(agent, record)
      return vtFlowApi.notifyCredentialStateChange({
        vtFlowRecordId: record.id,
        state: VtCredentialState.Revoked,
        reason,
      })
    })
  }

  private async revokeIssuedCredential(agent: VsAgent, record: VtFlowRecord): Promise<void> {
    record.assertState([VtFlowState.Completed, VtFlowState.CredRevoked])
    if (!record.credentialExchangeRecordId) {
      throw new AdminApiError(
        AdminApiErrorCode.UnsupportedFormat,
        HttpStatus.BAD_REQUEST,
        'the flow holds no credential exchange to revoke',
      )
    }
    const credential = await agent.didcomm.credentials.findById(record.credentialExchangeRecordId)
    if (!credential) {
      throw new AdminApiError(
        AdminApiErrorCode.UnsupportedFormat,
        HttpStatus.BAD_REQUEST,
        'the credential exchange of the flow no longer exists',
      )
    }
    const registryId = credential.getTag('anonCredsRevocationRegistryId')
    const revocationId = credential.getTag('anonCredsCredentialRevocationId')
    if (typeof registryId !== 'string' || !revocationId) {
      throw new AdminApiError(
        AdminApiErrorCode.UnsupportedFormat,
        HttpStatus.BAD_REQUEST,
        'the credential of the flow supports no credential-level revocation',
      )
    }
    await this.credentialTypesService.revokeCredential(agent, registryId, Number(revocationId))
  }

  private async filterByValidatorParticipant(
    agent: VsAgent,
    records: VtFlowRecord[],
    validatorParticipantId: string,
  ): Promise<VtFlowRecord[]> {
    const chain = this.requireChain(agent)
    const validatorByApplicant = new Map<string, string | undefined>()
    const kept: VtFlowRecord[] = []
    for (const record of records) {
      if (!record.participantId) continue
      if (!validatorByApplicant.has(record.participantId)) {
        const participant = await chain.getParticipant(Number(record.participantId)).catch(() => undefined)
        validatorByApplicant.set(
          record.participantId,
          participant?.validatorParticipantId ? String(participant.validatorParticipantId) : undefined,
        )
      }
      if (validatorByApplicant.get(record.participantId) === validatorParticipantId) kept.push(record)
    }
    return kept
  }

  private async mutateFlow(
    participantSessionId: string,
    action: (ctx: { agent: VsAgent; vtFlowApi: VtFlowApi; record: VtFlowRecord }) => Promise<VtFlowRecord>,
  ): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await this.findRecordBySession(vtFlowApi, participantSessionId)
    try {
      return toDto(await resolveFlow(agent, await action({ agent, vtFlowApi, record })))
    } catch (error) {
      if (error instanceof CredoError) throw new ConflictException(error.message)
      throw error
    }
  }

  private async assertConnectionEstablished(agent: VsAgent, record: VtFlowRecord): Promise<void> {
    const connection = await agent.didcomm.connections.findById(record.connectionId)
    if (!connection?.isReady) {
      throw new ConflictException('Flow connection is not in ESTABLISHED state')
    }
  }

  public async validateAndOfferCredential(participantSessionId: string): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    this.requireChain(agent)

    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await this.findRecordBySession(vtFlowApi, participantSessionId)
    if (record.role !== VtFlowRole.Validator) {
      throw new ConflictException('This record is applicant-side; validate is a validator action')
    }
    if (record.variant !== VtFlowVariant.OnboardingProcess) {
      throw new ConflictException(
        `This record is variant '${record.variant}'; validate only applies to OnboardingProcess`,
      )
    }
    // A repeat call re-drives the offer of a record that reached VALIDATED and has no credential
    // exchange. It recovers a credential build or an offer that failed after the chain write.
    const resumeOffer = record.state === VtFlowState.Validated && !record.credentialExchangeRecordId
    if (record.state !== VtFlowState.AwaitingOr && !resumeOffer) {
      throw new ConflictException(
        `Record state is '${record.state}'; validate applies to '${VtFlowState.AwaitingOr}', or to ` +
          `'${VtFlowState.Validated}' with no credential exchange`,
      )
    }
    if (!record.participantId) throw new ConflictException('Record has no participantId')

    const applicant = await agent.indexer.getParticipant(Number(record.participantId))
    if (!applicant)
      throw new BadRequestException(`Applicant participant ${record.participantId} not found on indexer`)
    if (applicant.schema_id == null) throw new BadRequestException('Applicant participant has no schema_id')

    const orchestrator = new VtFlowOrchestrator(agent, {
      publicApiBaseUrl: agent.publicApiBaseUrl,
    })
    try {
      const {
        record: validated,
        participant,
        credential,
      } = await orchestrator.validateOnboardingProcess({
        vtFlowRecordId: record.id,
        credentialSchemaId: String(applicant.schema_id),
      })

      // Only a HOLDER receives a credential. For every other role the chain records the outcome
      // with SetParticipantOPToValidated, and the process ends there. The schema of an ISSUER
      // entry describes what that issuer will give to others, so building a credential from it
      // for the issuer itself fails on the required subject claims.
      if (participant.role !== HOLDER_PARTICIPANT_TYPE) {
        const completed = await orchestrator.completeOnboardingProcess(validated.id)
        return toDto(await resolveFlow(agent, completed))
      }

      const offered = await orchestrator.offerOnboardingCredential({
        vtFlowRecordId: validated.id,
        credentialSchemaId: String(applicant.schema_id),
        participant,
        credential,
      })
      return toDto(await resolveFlow(agent, offered))
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
}

/**
 * One flow record with the connection data that the flow record does not hold.
 */
interface ResolvedFlow {
  record: VtFlowRecord
  peerDid?: string
  connectionState: VtConnectionState
}

/**
 * Filters that select the flows. The names follow [VSA-ADM-VT-FL-LIST] listFlows. The v1 query
 * maps its snake_case names onto these.
 */
interface FlowFilters {
  role?: VtFlowRole
  connectionState?: VtConnectionState
  flowState?: VtFlowState
  peerDid?: string
  participantId?: string
  schemaId?: string
  participantSessionId?: string
}

/**
 * Gives the Connection State of one flow, per [VSA-VTI-FLOW-STATE] Flow State. A flow in a
 * terminal state is TERMINATED, and so is a flow whose connection no longer exists.
 */
function connectionStateOf(
  record: VtFlowRecord,
  connection: DidCommConnectionRecord | null | undefined,
): VtConnectionState {
  if (isVtFlowTerminalState(record.state) || !connection) return 'TERMINATED'
  return connection.isReady ? 'ESTABLISHED' : 'NOT_CONNECTED'
}

/**
 * Makes the v2 flow record of [VSA-ADM-VT-FL-LIST] listFlows. v2 renames `state` to `flowState`
 * and keeps every other field. The v1 record goes away with the v1 API, and this mapper with it.
 */
export function toV2Dto({ state, ...rest }: VtFlowRecordDto): V2VtFlowRecordDto {
  return { ...rest, flowState: state }
}

export async function resolveV2FlowRecord(agent: VsAgent, record: VtFlowRecord): Promise<V2VtFlowRecordDto> {
  return toV2Dto(toDto(await resolveFlow(agent, record)))
}

async function resolveFlow(agent: VsAgent, record: VtFlowRecord): Promise<ResolvedFlow> {
  const connection = await agent.didcomm.connections.findById(record.connectionId)
  return {
    record,
    peerDid: connection?.theirDid,
    connectionState: connectionStateOf(record, connection),
  }
}

function toDto({ record, peerDid, connectionState }: ResolvedFlow): VtFlowRecordDto {
  return {
    peerDid,
    connectionState,
    oobLinkUrl: record.oobLinkUrl,
    proofs: record.proofsAttach,
    credentialDigest: record.credentialDigest,
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
    lastEventAt: record.updatedAt ?? record.createdAt,
  }
}
