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
  VtFlowPendingAction,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowTxStatus,
  VtFlowVariant,
  isVtFlowTerminalState,
  peerAnchorDid,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { HOLDER_PARTICIPANT_TYPE, VtFlowOrchestrator } from '@verana-labs/vs-agent-sdk'

import { AdminApiError, AdminApiErrorCode, createdAtKey, Page, paginate } from '../../../../common'
import { CredentialTypesService } from '../../../../services/CredentialTypesService'
import { VsAgentService } from '../../../../services/VsAgentService'

import { ListFlowsV2QueryDto } from './dto/flow-requests.dto'
import { V2VtFlowRecordDto, VtConnectionState } from './dto/vt-flow-record.dto'

type VtFlowRecordDto = Omit<V2VtFlowRecordDto, 'flowState'> & { state: VtFlowState }

@Injectable()
export class VtFlowsService {
  public constructor(
    @Inject(VsAgentService) private readonly agentService: VsAgentService,
    @Inject(CredentialTypesService) private readonly credentialTypesService: CredentialTypesService,
  ) {}

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
          applicantParticipantId: query.applicantParticipantId,
          validatorParticipantId: query.validatorParticipantId,
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
    const records = await vtFlowApi.findAllByQuery({
      ...(query.role && { role: query.role }),
      ...(query.flowState && { flowState: query.flowState }),
      ...(query.applicantParticipantId && { applicantParticipantId: query.applicantParticipantId }),
      ...(query.validatorParticipantId && { validatorParticipantId: query.validatorParticipantId }),
      ...(query.schemaId && { schemaId: query.schemaId }),
      ...(query.participantSessionId && { participantSessionId: query.participantSessionId }),
    })

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
      const peerDid = connection ? peerAnchorDid(connection) : undefined
      if (query.peerDid && peerDid !== query.peerDid) continue
      if (query.connectionState && connectionState !== query.connectionState) continue
      flows.push({ record, peerDid, connectionState })
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
    if (!record.applicantParticipantId) throw new ConflictException('Record has no applicantParticipantId')

    const applicant = await agent.indexer.getParticipant(Number(record.applicantParticipantId))
    if (!applicant)
      throw new BadRequestException(
        `Applicant participant ${record.applicantParticipantId} not found on indexer`,
      )
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
 * Filters that select the flows. The names follow [VSA-ADM-VT-FL-LIST] listFlows.
 */
interface FlowFilters {
  role?: VtFlowRole
  connectionState?: VtConnectionState
  flowState?: VtFlowState
  peerDid?: string
  applicantParticipantId?: string
  validatorParticipantId?: string
  schemaId?: string
  participantSessionId?: string
}

const AGENT_STATES: ReadonlySet<VtFlowState> = new Set([
  VtFlowState.OrSent,
  VtFlowState.IrSent,
  VtFlowState.AwaitingOr,
  VtFlowState.AwaitingIr,
])

const VALIDATOR_STATES: ReadonlySet<VtFlowState> = new Set([
  VtFlowState.Validating,
  VtFlowState.AwaitingValidationTx,
  VtFlowState.ValidationTxFailed,
  VtFlowState.ValidatedPendingClaims,
])

/**
 * Gives the party that must act for a flow to progress, per the [VSA-ADM-VT-FL-LIST] pendingAction
 * table. An expired oob-link hands OOB_PENDING back to the validator, and a failed issuance
 * anchoring hands CRED_OFFERED back to it so the operator can re-anchor.
 */
function pendingActionOf(record: VtFlowRecord): VtFlowPendingAction {
  const { state, role } = record
  if (isVtFlowTerminalState(state)) return VtFlowPendingAction.None

  if (state === VtFlowState.AwaitingOp) {
    return role === VtFlowRole.Applicant ? VtFlowPendingAction.Applicant : VtFlowPendingAction.None
  }
  if (AGENT_STATES.has(state)) return VtFlowPendingAction.Agent
  if (state === VtFlowState.OobPending) {
    const expiresAt = record.oobLink?.expiresAt
    const expired = expiresAt !== undefined && Date.parse(expiresAt) <= Date.now()
    return expired ? VtFlowPendingAction.Validator : VtFlowPendingAction.Applicant
  }
  if (VALIDATOR_STATES.has(state)) {
    if (state !== VtFlowState.Validating && role === VtFlowRole.Applicant) {
      return VtFlowPendingAction.None
    }
    return VtFlowPendingAction.Validator
  }
  if (state === VtFlowState.ValidationTxSubmitted) {
    return role === VtFlowRole.Applicant ? VtFlowPendingAction.None : VtFlowPendingAction.Chain
  }
  if (state === VtFlowState.Validated) {
    return record.applicantParticipantRole === HOLDER_PARTICIPANT_TYPE
      ? VtFlowPendingAction.Agent
      : VtFlowPendingAction.None
  }
  if (state === VtFlowState.CredOffered) {
    const anchoringFailed = record.issuance?.tx?.status === VtFlowTxStatus.Failed
    return role === VtFlowRole.Validator && anchoringFailed
      ? VtFlowPendingAction.Validator
      : VtFlowPendingAction.Agent
  }
  return VtFlowPendingAction.None
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
 * and keeps every other field.
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
    peerDid: connection ? peerAnchorDid(connection) : undefined,
    connectionState: connectionStateOf(record, connection),
  }
}

function toDto({ record, peerDid, connectionState }: ResolvedFlow): VtFlowRecordDto {
  return {
    peerDid,
    connectionState,
    oobLink: record.oobLink && {
      url: record.oobLink.url,
      description: record.oobLink.description,
      expiresAt: record.oobLink.expiresAt,
      at: record.oobLink.at,
    },
    messages: (record.messages ?? []).map(message => ({
      type: message.type,
      text: message.text,
      at: message.at,
      url: message.url,
    })),
    pendingAction: pendingActionOf(record),
    validation: record.validation,
    issuance: record.issuance,
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
    applicantParticipantId: record.applicantParticipantId,
    validatorParticipantId: record.validatorParticipantId,
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
