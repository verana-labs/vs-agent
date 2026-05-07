import type { JsonObject } from '@credo-ts/core'

import { JsonTransformer, W3cCredential, W3cJsonLdVerifiableCredential, utils } from '@credo-ts/core'
import { DidCommHandshakeProtocol, type JsonCredential } from '@credo-ts/didcomm'
import {
  VtFlowApi,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'

import { BaseAgentModules, VsAgent } from '../agent'
import { ISSUER_PERMISSION_TYPE, VeranaChainService } from '../blockchain'
import { createCredential, createVtc, generateDigestSRI, getVerificationMethodId, signerW3c } from '../utils'

export interface VtFlowOrchestratorOptions {
  publicApiBaseUrl?: string
}

export interface StartValidationProcessInput {
  applicantPermId: number
  sessionUuid?: string
  claims?: Record<string, unknown>
}

export interface ValidateAndOfferCredentialInput {
  vtFlowRecordId: string
  credentialType?: string[]
  credentialContext?: string[]
  credentialSchemaId: string
}

export interface AcceptCredentialInput {
  vtFlowRecordId: string
}

export class VtFlowOrchestrator {
  constructor(
    private readonly agent: VsAgent<BaseAgentModules>,
    private readonly options: VtFlowOrchestratorOptions = {},
  ) {}

  async startValidationProcess(input: StartValidationProcessInput): Promise<VtFlowRecord> {
    const chain = this.requireChain()
    if (!this.agent.did) throw new Error('Agent has no public DID')

    const holderPerm = await chain.getPermission(input.applicantPermId)
    if (!holderPerm) {
      throw new Error(`Applicant permission ${input.applicantPermId} not found on chain`)
    }
    if (holderPerm.did !== this.agent.did) {
      throw new Error(`Applicant permission ${input.applicantPermId} does not belong to this agent`)
    }
    if (holderPerm.type !== ISSUER_PERMISSION_TYPE) {
      throw new Error(`Permission ${input.applicantPermId} is not a HOLDER permission`)
    }
    if (!holderPerm.validatorPermId) {
      throw new Error(`Applicant permission ${input.applicantPermId} has no validator_perm_id`)
    }

    const validatorPerm = await chain.getPermission(Number(holderPerm.validatorPermId))
    if (!validatorPerm?.did) {
      throw new Error(`Validator permission ${holderPerm.validatorPermId} not resolvable`)
    }
    if (validatorPerm.revoked || validatorPerm.slashed) {
      throw new Error(`Validator permission ${validatorPerm.id} is not active`)
    }

    const { connectionRecord } = await this.agent.didcomm.oob.receiveImplicitInvitation({
      did: validatorPerm.did,
      label: this.agent.label,
      handshakeProtocols: [DidCommHandshakeProtocol.Connections],
    })
    if (!connectionRecord) throw new Error('Failed to establish DIDComm connection to validator')
    const ready = await this.agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id)

    return this.resolveVtFlowApi().sendValidationRequest({
      connectionId: ready.id,
      sessionUuid: input.sessionUuid ?? utils.uuid(),
      permId: String(holderPerm.id),
      agentPermId: '0',
      walletAgentPermId: '0',
      claims: input.claims,
    })
  }

  async validateAndOfferCredential(input: ValidateAndOfferCredentialInput): Promise<VtFlowRecord> {
    const chain = this.requireChain()
    if (!this.agent.did) throw new Error('Agent has no public DID')

    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(input.vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${input.vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Validator) throw new Error('Record is not validator-side')
    if (record.variant !== VtFlowVariant.ValidationProcess) {
      throw new Error(`Record variant is '${record.variant}', expected ValidationProcess`)
    }
    if (record.state !== VtFlowState.AwaitingVr) {
      throw new Error(`Record state is '${record.state}', expected '${VtFlowState.AwaitingVr}'`)
    }
    if (!record.permId) throw new Error('Record has no permId')

    const holderPermId = Number(record.permId)
    const holderPerm = await chain.getPermission(holderPermId)
    if (!holderPerm) throw new Error(`Holder permission ${holderPermId} not found on chain`)
    if (!holderPerm.did) throw new Error('Holder permission has no DID')

    const didRecords = await this.agent.dids.getCreatedDids({ did: this.agent.did })
    const didRecord = didRecords[0]
    if (!didRecord) throw new Error('Agent DID record not found')
    const verificationMethodId = getVerificationMethodId(this.agent.config.logger, didRecord)

    const claims = (record.claims ?? {}) as JsonObject
    const unsignedCredential = createCredential({
      id: `${this.agent.did}#${utils.uuid()}`,
      type: input.credentialType ?? ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: this.agent.did,
      credentialSubject: { id: holderPerm.did, claims },
    })
    if (input.credentialContext) unsignedCredential.context = input.credentialContext
    unsignedCredential.credentialSchema = {
      id: input.credentialSchemaId,
      type: 'JsonSchemaCredential',
    }

    const signed = await signerW3c(
      this.agent,
      JsonTransformer.fromJSON(unsignedCredential, W3cCredential),
      verificationMethodId,
    )
    const digest = generateDigestSRI(JSON.stringify(signed.jsonCredential))

    await chain.setPermissionVPToValidated({ id: holderPermId, vpSummaryDigest: digest })
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
    return offered
  }

  async acceptCredential(input: AcceptCredentialInput): Promise<VtFlowRecord> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(input.vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${input.vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Applicant) throw new Error('Record is not applicant-side')
    return vtFlowApi.acceptReceivedCredential(input.vtFlowRecordId)
  }

  async publishCredentialAsLinkedVp(vtFlowRecordId: string): Promise<void> {
    if (!this.options.publicApiBaseUrl) {
      throw new Error('publicApiBaseUrl is required to publish a LinkedVerifiablePresentation')
    }
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Applicant) throw new Error('Record is not applicant-side')
    if (!record.credentialExchangeRecordId) {
      throw new Error(`vt-flow record ${vtFlowRecordId} has no credentialExchangeRecordId`)
    }

    const formatData = await this.agent.didcomm.credentials.getFormatData(record.credentialExchangeRecordId)
    const jsonld = (formatData.credential as { jsonld?: unknown } | undefined)?.jsonld
    if (!jsonld) {
      throw new Error(`No jsonld credential in exchange ${record.credentialExchangeRecordId}`)
    }
    const w3cCredential = JsonTransformer.fromJSON(jsonld, W3cJsonLdVerifiableCredential)
    await createVtc(this.agent, this.options.publicApiBaseUrl, record.id, w3cCredential)
  }

  private resolveVtFlowApi(): VtFlowApi {
    return this.agent.dependencyManager.resolve(VtFlowApi)
  }

  private requireChain(): VeranaChainService {
    if (!this.agent.veranaChain) {
      throw new Error('Agent has no veranaChain configured')
    }
    return this.agent.veranaChain
  }
}
