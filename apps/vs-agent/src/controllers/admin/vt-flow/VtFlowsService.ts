import type { JsonObject } from '@credo-ts/core'
import type { VsAgent, VeranaChainService } from '@verana-labs/vs-agent-sdk'

import { JsonTransformer, W3cCredential, utils } from '@credo-ts/core'
import { type JsonCredential } from '@credo-ts/didcomm'
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
import {
  VeranaIndexerService,
  createCredential,
  generateDigestSRI,
  getVerificationMethodId,
  signerW3c,
} from '@verana-labs/vs-agent-sdk'

import { ADMIN_LOG_LEVEL, VERANA_INDEXER_BASE_URL } from '../../../config'
import { VsAgentService } from '../../../services/VsAgentService'
import { TsLogger } from '../../../utils'

import { ValidateFlowDto } from './dto/validate-flow.dto'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@Injectable()
export class VtFlowsService {
  private indexerService?: VeranaIndexerService

  public constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

  public async validateAndOfferCredential(
    vtFlowRecordId: string,
    input: ValidateFlowDto,
  ): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    const chain = this.requireChain(agent)
    if (!agent.did) throw new BadRequestException('Agent has no public DID')

    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new NotFoundException(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Validator) {
      throw new BadRequestException('This record is applicant-side; validate is a validator action')
    }
    if (record.variant !== VtFlowVariant.ValidationProcess) {
      throw new BadRequestException(
        `This record is variant '${record.variant}'; validate only applies to ValidationProcess`,
      )
    }
    if (record.state !== VtFlowState.AwaitingVr) {
      throw new BadRequestException(`Record state is '${record.state}', expected '${VtFlowState.AwaitingVr}'`)
    }
    if (!record.permId) throw new BadRequestException('Record has no permId')

    const indexer = this.getIndexer()
    const holderPermId = this.parsePermId(record.permId, 'record.permId')
    const holderPerm = await indexer.getPermission(holderPermId)
    if (!holderPerm) throw new BadRequestException(`Holder permission ${holderPermId} not found on indexer`)
    if (!holderPerm.did) throw new BadRequestException('Holder permission has no DID')

    const subjectDid = holderPerm.did
    const didRecords = await agent.dids.getCreatedDids({ did: agent.did })
    const didRecord = didRecords[0]
    if (!didRecord) throw new BadRequestException('Agent DID record not found')
    const verificationMethodId = getVerificationMethodId(agent.config.logger, didRecord)

    const claims = (record.claims ?? {}) as JsonObject
    const unsignedCredential = createCredential({
      id: `${agent.did}#${utils.uuid()}`,
      type: ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: agent.did,
      credentialSubject: { id: subjectDid, claims },
    })
    unsignedCredential.credentialSchema = {
      id: input.credentialSchemaCredentialId,
      type: 'JsonSchemaCredential',
    }

    const signed = await signerW3c(
      agent,
      JsonTransformer.fromJSON(unsignedCredential, W3cCredential),
      verificationMethodId,
    )
    const digest = generateDigestSRI(JSON.stringify(signed.jsonCredential))

    await this.runChainTx(agent, 'set-perm-vp-validated', () =>
      chain.setPermissionVPToValidated({
        id: holderPermId,
        vpSummaryDigest: digest,
      }),
    )
    await this.runChainTx(agent, 'create-or-update-permission-session', () =>
      chain.createOrUpdatePermissionSession({
        id: record.sessionUuid,
        agentPermId: 0,
        walletAgentPermId: 0,
        digest,
      }),
    )

    await vtFlowApi.acceptValidationRequest(record.id)
    await vtFlowApi.markValidated(record.id)

    const { record: offered } = await vtFlowApi.offerCredentialForSession({
      vtFlowRecordId: record.id,
      credentialFormats: {
        jsonld: {
          credential: signed.jsonCredential as unknown as JsonCredential,
          options: { proofType: 'Ed25519Signature2020', proofPurpose: 'assertionMethod' },
        },
      },
    })
    return toDto(offered)
  }

  private resolveVtFlowApi(agent: VsAgent): VtFlowApi {
    return agent.dependencyManager.resolve(VtFlowApi)
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

  private parsePermId(value: string, field: string): number {
    const n = Number.parseInt(value, 10)
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException(`Invalid ${field}: '${value}' is not a non-negative integer`)
    }
    return n
  }

  private async runChainTx<T>(agent: VsAgent, label: string, fn: () => Promise<T>): Promise<T> {
    const logger = agent.config.logger
    logger.debug(`[VtFlowsService] Broadcasting ${label}`)
    try {
      const result = await fn()
      logger.info(`[VtFlowsService] ${label} broadcast OK`)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[VtFlowsService] ${label} broadcast failed: ${message}`)
      throw new HttpException(`${label} failed: ${message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}

function toDto(record: VtFlowRecord): VtFlowRecordDto {
  return {
    vtFlowRecordId: record.id,
    threadId: record.threadId,
    sessionUuid: record.sessionUuid,
    connectionId: record.connectionId,
    role: record.role,
    variant: record.variant,
    state: record.state,
    agentPermId: record.agentPermId,
    walletAgentPermId: record.walletAgentPermId,
    permId: record.permId,
    schemaId: record.schemaId,
    claims: record.claims,
    credentialExchangeRecordId: record.credentialExchangeRecordId,
    subprotocolThid: record.subprotocolThid,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}
