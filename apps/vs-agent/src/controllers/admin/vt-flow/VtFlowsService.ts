import type { JsonObject } from '@credo-ts/core'
import type { Permission, VsAgent, VeranaChainService } from '@verana-labs/vs-agent-sdk'

import { JsonTransformer, W3cCredential, utils } from '@credo-ts/core'
import { DidCommHandshakeProtocol, type JsonCredential } from '@credo-ts/didcomm'
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
  HOLDER_PERMISSION_TYPE,
  createCredential,
  generateDigestSRI,
  getVerificationMethodId,
  signerW3c,
} from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'

import { StartValidationProcessDto } from './dto/start-validation-process.dto'
import { ValidateFlowDto } from './dto/validate-flow.dto'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@Injectable()
export class VtFlowsService {
  public constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

  public async startValidationProcess(input: StartValidationProcessDto): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    const chain = this.requireChain(agent)
    if (!agent.did) throw new BadRequestException('Agent has no public DID')

    const validatorPermId = this.parsePermId(input.validatorPermId, 'validatorPermId')
    const validatorPerm = await chain.getPermission(validatorPermId)
    if (!validatorPerm) throw new NotFoundException(`Validator permission ${validatorPermId} not found`)
    if (validatorPerm.revoked || validatorPerm.slashed) {
      throw new BadRequestException(`Validator permission ${validatorPermId} is not active`)
    }
    if (!validatorPerm.did) {
      throw new BadRequestException(`Validator permission ${validatorPermId} has no DID`)
    }

    await chain.startPermissionVP({
      type: HOLDER_PERMISSION_TYPE,
      validatorPermId,
      did: agent.did,
    })

    const holderPerm = await this.findHolderPermission(chain, agent.did, validatorPermId)
    if (!holderPerm) {
      throw new HttpException(
        'HOLDER permission not found after start-perm-vp; chain indexing may be lagging',
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }

    const { connectionRecord } = await agent.didcomm.oob.receiveImplicitInvitation({
      did: validatorPerm.did,
      label: agent.label,
      handshakeProtocols: [DidCommHandshakeProtocol.Connections],
    })
    if (!connectionRecord) {
      throw new HttpException(
        'Failed to establish DIDComm connection to validator',
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
    const ready = await agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id)

    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await vtFlowApi.sendValidationRequest({
      connectionId: ready.id,
      sessionUuid: input.sessionUuid ?? utils.uuid(),
      permId: String(holderPerm.id),
      agentPermId: '0',
      walletAgentPermId: '0',
      claims: input.claims,
    })

    return toDto(record)
  }

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

    const holderPermId = this.parsePermId(record.permId, 'record.permId')
    const holderPerm = await chain.getPermission(holderPermId)
    if (!holderPerm) throw new BadRequestException(`Holder permission ${holderPermId} not found on chain`)
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

    await chain.setPermissionVPToValidated({
      id: holderPermId,
      vpSummaryDigest: digest,
    })
    await chain.createOrUpdatePermissionSession({
      id: record.sessionUuid,
      agentPermId: 0,
      walletAgentPermId: 0,
      digest,
    })

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

  public async acceptCredential(vtFlowRecordId: string): Promise<VtFlowRecordDto> {
    const agent = await this.agentService.getAgent()
    const vtFlowApi = this.resolveVtFlowApi(agent)
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new NotFoundException(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Applicant) {
      throw new BadRequestException('This record is validator-side; accept-credential is an applicant action')
    }
    const updated = await vtFlowApi.acceptReceivedCredential(vtFlowRecordId)
    return toDto(updated)
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

  private parsePermId(value: string, field: string): number {
    const n = Number.parseInt(value, 10)
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException(`Invalid ${field}: '${value}' is not a non-negative integer`)
    }
    return n
  }

  private async findHolderPermission(
    chain: VeranaChainService,
    did: string,
    validatorPermId: number,
  ): Promise<Permission | undefined> {
    const perms = await chain.findPermissionsWithDID({ did })
    const holders = perms.filter(
      p => p.type === HOLDER_PERMISSION_TYPE && Number(p.validatorPermId) === validatorPermId,
    )
    holders.sort((a, b) => Number(b.id) - Number(a.id))
    return holders[0]
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
