import type { JsonObject } from '@credo-ts/core'

import { JsonTransformer, W3cJsonLdVerifiableCredential, utils } from '@credo-ts/core'
import {
  DidCommHandshakeProtocol,
  type JsonCredential,
  type JsonLdFormatDataVerifiableCredential,
} from '@credo-ts/didcomm'
import {
  VtFlowApi,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'

import { BaseAgentModules, VsAgent } from '../agent'
import { VeranaIndexerService } from '../blockchain/VeranaIndexerService'
import { ISSUER_PERMISSION_TYPE } from '../types'
import { createCredential, createVtc, findMetadataEntry } from '../utils'

import { credentialContentDigest } from './credentialDigest'

export interface VtFlowOrchestratorOptions {
  publicApiBaseUrl?: string
  indexer?: VeranaIndexerService
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
  agentPermId?: number
  walletAgentPermId?: number
}

export interface AcceptCredentialInput {
  vtFlowRecordId: string
}

export class VtFlowOrchestrator {
  constructor(
    private readonly agent: VsAgent<BaseAgentModules>,
    private readonly options: VtFlowOrchestratorOptions = {},
  ) {}

  async startOnboardingProcess(input: StartValidationProcessInput): Promise<VtFlowRecord> {
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
      throw new Error(`Permission ${input.applicantPermId} is not an ISSUER permission`)
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

    return this.resolveVtFlowApi().sendOnboardingRequest({
      connectionId: ready.id,
      participantSessionId: input.sessionUuid ?? utils.uuid(),
      participantId: String(holderPerm.id),
      agentParticipantId: '0',
      walletAgentParticipantId: '0',
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
    if (record.variant !== VtFlowVariant.OnboardingProcess) {
      throw new Error(`Record variant is '${record.variant}', expected OnboardingProcess`)
    }
    if (record.state !== VtFlowState.AwaitingOr) {
      throw new Error(`Record state is '${record.state}', expected '${VtFlowState.AwaitingOr}'`)
    }
    if (!record.participantId) throw new Error('Record has no permId')

    const holderPermId = Number(record.participantId)
    const holderPerm = await chain.getPermission(holderPermId)
    if (!holderPerm) throw new Error(`Holder permission ${holderPermId} not found on chain`)
    if (!holderPerm.did) throw new Error('Holder permission has no DID')

    const didRecords = await this.agent.dids.getCreatedDids({ did: this.agent.did })
    const didRecord = didRecords[0]
    if (!didRecord) throw new Error('Agent DID record not found')
    const schemaRef = `vpr:verana:${chain.getChainId}/cs/v1/js/${input.credentialSchemaId}`
    const { data } = await findMetadataEntry(didRecord, '_vt/jsc', '', schemaRef)

    const claims = (record.claims ?? {}) as JsonObject
    const unsignedCredential = createCredential({
      id: `${this.agent.did}#${utils.uuid()}`,
      type: input.credentialType ?? ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: this.agent.did,
      credentialSubject: { id: holderPerm.did, claims },
    })
    if (input.credentialContext) unsignedCredential.context = input.credentialContext
    unsignedCredential.credentialSchema = {
      id: data.verifiableCredential?.[0]?.id,
      type: 'JsonSchemaCredential',
    }

    const unsignedCredentialJson = JsonTransformer.toJSON(unsignedCredential) as JsonCredential

    const digest = credentialContentDigest(unsignedCredentialJson)

    await chain.setPermissionVPToValidated({
      id: holderPermId,
      vpSummaryDigest: digest,
      corporation: holderPerm.corporation,
    })
    await chain.createOrUpdatePermissionSession({
      id: record.participantSessionId,
      issuerPermId: holderPermId,
      agentPermId: input.agentPermId ?? 0,
      walletAgentPermId: input.walletAgentPermId ?? 0,
      digest,
    })

    await vtFlowApi.acceptOnboardingRequest(record.id)
    await vtFlowApi.markValidated(record.id)

    const { record: offered } = await vtFlowApi.offerCredentialForSession({
      vtFlowRecordId: record.id,
      credentialFormats: {
        jsonld: {
          credential: unsignedCredentialJson,
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
    if (record.state !== VtFlowState.CredOffered) {
      throw new Error(`Record state is '${record.state}', expected '${VtFlowState.CredOffered}'`)
    }
    await this.verifyOfferedCredential(input.vtFlowRecordId)
    return vtFlowApi.acceptReceivedCredential(input.vtFlowRecordId)
  }

  async verifyOfferedCredential(vtFlowRecordId: string): Promise<void> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Applicant) throw new Error('Record is not applicant-side')
    if (!record.participantId) throw new Error('Record has no permId')
    if (!record.credentialExchangeRecordId) {
      throw new Error('Record has no credentialExchangeRecordId; nothing to verify')
    }

    const { validatorPermActive, vpSummaryDigest } = await this.resolveHolderAndValidatorState(
      Number(record.participantId),
    )
    if (!validatorPermActive) throw new Error('Validator permission is not active')

    if (!vpSummaryDigest) {
      throw new Error('No credential digest recorded in the on-chain ParticipantSession')
    }
    const formatData = await this.agent.didcomm.credentials.getFormatData(record.credentialExchangeRecordId)
    const credentialJson = (
      formatData.credential as { jsonld?: JsonLdFormatDataVerifiableCredential } | undefined
    )?.jsonld
    if (!credentialJson) throw new Error('Offered credential has no JSON-LD body to verify')
    const computed = credentialContentDigest(credentialJson)
    if (computed !== vpSummaryDigest) {
      throw new Error(`Credential digest mismatch: computed=${computed} on-chain=${vpSummaryDigest}`)
    }
  }

  private async resolveHolderAndValidatorState(
    holderPermId: number,
  ): Promise<{ validatorPermActive: boolean; vpSummaryDigest?: string }> {
    const indexer = this.options.indexer
    if (indexer) {
      const holder = await indexer.getPermission(holderPermId)
      if (!holder) throw new Error(`Holder permission ${holderPermId} not found on indexer`)
      if (!holder.validator_perm_id) throw new Error('Holder permission has no validator_perm_id')
      const validator = await indexer.getPermission(holder.validator_perm_id)
      if (!validator) {
        throw new Error(`Validator permission ${holder.validator_perm_id} not found on indexer`)
      }
      return {
        validatorPermActive: validator.perm_state === 'ACTIVE',
        vpSummaryDigest: holder.vp_summary_digest,
      }
    }
    const chain = this.requireChain()
    const holder = await chain.getPermission(holderPermId)
    if (!holder) throw new Error(`Holder permission ${holderPermId} not found on chain`)
    if (!holder.validatorPermId) throw new Error('Holder permission has no validator_perm_id')
    const validator = await chain.getPermission(Number(holder.validatorPermId))
    if (!validator) throw new Error(`Validator permission ${holder.validatorPermId} not found on chain`)
    return {
      validatorPermActive: !validator.revoked && !validator.slashed,
      vpSummaryDigest: holder.vpSummaryDigest,
    }
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
    const schemaRef = (jsonld as { credentialSchema?: { id?: string } }).credentialSchema?.id
    const schemaBaseId = schemaRef ? this.extractSchemaBaseId(schemaRef) : undefined
    if (!schemaBaseId) {
      throw new Error(
        `Cannot publish Linked VP: credential has no extractable schema base id (credentialSchema.id=${schemaRef ?? 'undefined'})`,
      )
    }
    const w3cCredential = JsonTransformer.fromJSON(jsonld, W3cJsonLdVerifiableCredential)
    await createVtc(this.agent, this.options.publicApiBaseUrl, schemaBaseId, w3cCredential)
  }

  private extractSchemaBaseId(jscUrl: string): string | undefined {
    const match = jscUrl.match(/schemas-([a-z0-9-]+?)-(?:jsc|c-vp)\.json/i)
    return match?.[1]?.toLowerCase()
  }

  private resolveVtFlowApi(): VtFlowApi {
    return this.agent.dependencyManager.resolve(VtFlowApi)
  }

  private requireChain() {
    if (!this.agent.veranaChain) {
      throw new Error('Agent has no veranaChain configured')
    }
    return this.agent.veranaChain
  }
}
