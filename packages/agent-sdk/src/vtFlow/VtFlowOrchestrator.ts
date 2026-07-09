import type { JsonObject } from '@credo-ts/core'

import { JsonTransformer, W3cJsonLdVerifiableCredential, utils } from '@credo-ts/core'
import { type JsonCredential, type JsonLdFormatDataVerifiableCredential } from '@credo-ts/didcomm'
import {
  VtFlowApi,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'

import { BaseAgentModules, VsAgent } from '../agent'
import { VeranaIndexerService } from '../blockchain/VeranaIndexerService'
import { ParticipantRole, ParticipantState } from '../blockchain/types'
import { HOLDER_PARTICIPANT_TYPE, ISSUER_PARTICIPANT_TYPE } from '../types'
import { createCredential, createVtc, findMetadataEntry } from '../utils'

import { credentialContentDigest } from './credentialDigest'

export interface VtFlowOrchestratorOptions {
  publicApiBaseUrl?: string
  indexer?: VeranaIndexerService
}

export interface StartOnboardingProcessInput {
  applicantParticipantId: number
  participantSessionId?: string
  claims?: Record<string, unknown>
}

export interface ValidateAndOfferCredentialInput {
  vtFlowRecordId: string
  credentialType?: string[]
  credentialContext?: string[]
  credentialSchemaId: string
  agentParticipantId?: number
  walletAgentParticipantId?: number
}

export interface AcceptCredentialInput {
  vtFlowRecordId: string
}

export class VtFlowOrchestrator {
  constructor(
    private readonly agent: VsAgent<BaseAgentModules>,
    private readonly options: VtFlowOrchestratorOptions = {},
  ) {}

  async startOnboardingProcess(input: StartOnboardingProcessInput): Promise<VtFlowRecord> {
    const chain = this.requireChain()
    if (!this.agent.did) throw new Error('Agent has no public DID')

    const holderParticipant = await chain.getParticipant(input.applicantParticipantId)
    if (!holderParticipant) {
      throw new Error(`Applicant participant ${input.applicantParticipantId} not found on chain`)
    }
    if (holderParticipant.did !== this.agent.did) {
      throw new Error(`Applicant participant ${input.applicantParticipantId} does not belong to this agent`)
    }
    if (
      holderParticipant.role !== ISSUER_PARTICIPANT_TYPE &&
      holderParticipant.role !== HOLDER_PARTICIPANT_TYPE
    ) {
      throw new Error(`Participant ${input.applicantParticipantId} is not an ISSUER or HOLDER participant`)
    }
    if (!holderParticipant.validatorParticipantId) {
      throw new Error(`Applicant participant ${input.applicantParticipantId} has no validator_participant_id`)
    }

    const validatorParticipant = await chain.getParticipant(Number(holderParticipant.validatorParticipantId))
    if (!validatorParticipant?.did) {
      throw new Error(`Validator participant ${holderParticipant.validatorParticipantId} not resolvable`)
    }
    if (validatorParticipant.revoked || validatorParticipant.slashed) {
      throw new Error(`Validator participant ${validatorParticipant.id} is not active`)
    }

    const { connectionRecord } = await this.agent.didcomm.oob.receiveImplicitInvitation({
      did: validatorParticipant.did,
      ourDid: this.agent.did,
      label: this.agent.label,
      didCommVersion: 'v2',
    })
    if (!connectionRecord) throw new Error('Failed to establish DIDComm connection to validator')
    const ready = await this.agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id)

    return this.resolveVtFlowApi().sendOnboardingRequest({
      connectionId: ready.id,
      participantSessionId: input.participantSessionId ?? utils.uuid(),
      participantId: String(holderParticipant.id),
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
    if (!record.participantId) throw new Error('Record has no participantId')

    const holderParticipantId = Number(record.participantId)
    const holderParticipant = await chain.getParticipant(holderParticipantId)
    if (!holderParticipant) throw new Error(`Holder participant ${holderParticipantId} not found on chain`)
    if (!holderParticipant.did) throw new Error('Holder participant has no DID')

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
      credentialSubject: { id: holderParticipant.did, claims },
    })
    if (input.credentialContext) unsignedCredential.context = input.credentialContext
    unsignedCredential.credentialSchema = {
      id: data.verifiableCredential?.[0]?.id,
      type: 'JsonSchemaCredential',
    }

    const unsignedCredentialJson = JsonTransformer.toJSON(unsignedCredential) as JsonCredential

    const digest = credentialContentDigest(unsignedCredentialJson)

    await chain.setParticipantOPToValidated({
      id: holderParticipantId,
      opSummaryDigest: digest,
      corporation: holderParticipant.corporation,
    })
    await chain.createOrUpdateParticipantSession({
      id: record.participantSessionId,
      issuerParticipantId: holderParticipantId,
      agentParticipantId: input.agentParticipantId ?? 0,
      walletAgentParticipantId: input.walletAgentParticipantId ?? 0,
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
    if (!record.credentialExchangeRecordId) {
      throw new Error('Record has no credentialExchangeRecordId; nothing to verify')
    }
    const indexer = this.requireIndexer()

    const session = await indexer.getParticipantSession(record.participantSessionId)
    if (!session) {
      throw new Error(`ParticipantSession ${record.participantSessionId} not found on indexer`)
    }
    const issuerParticipantId = session.session_records?.find(
      r => r.issuer_participant_id != null,
    )?.issuer_participant_id
    if (issuerParticipantId == null) {
      throw new Error(`ParticipantSession ${record.participantSessionId} has no issuer_participant_id`)
    }

    const issuer = await indexer.getParticipant(issuerParticipantId)
    if (!issuer) throw new Error(`Issuer participant ${issuerParticipantId} not found on indexer`)
    if (issuer.role !== ParticipantRole.Issuer) {
      throw new Error(`Issuer participant ${issuerParticipantId} is not an ISSUER (role=${issuer.role})`)
    }
    if (issuer.participant_state !== ParticipantState.Active) {
      throw new Error(
        `Issuer participant ${issuerParticipantId} is not active (state=${issuer.participant_state})`,
      )
    }
    if (record.schemaId != null && Number(issuer.schema_id) !== Number(record.schemaId)) {
      throw new Error(
        `Issuer participant schema ${issuer.schema_id} does not match credential schema ${record.schemaId}`,
      )
    }

    const credentialJson = await this.getOfferedCredentialJson(record.credentialExchangeRecordId)
    const digest = credentialContentDigest(credentialJson)
    const anchored = await indexer.getDigest(digest)
    if (!anchored) {
      throw new Error(`Credential digest ${digest} is not anchored on-chain`)
    }
  }

  async onCredentialCompleted(vtFlowRecordId: string): Promise<void> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) return
    if (record.role !== VtFlowRole.Applicant) return
    if (!this.options.publicApiBaseUrl) return

    await this.publishCredentialAsLinkedVp(vtFlowRecordId)
    await this.triggerResolver(record)
  }

  private async triggerResolver(record: VtFlowRecord): Promise<void> {
    const chain = this.agent.veranaChain
    if (!chain || !chain.autoTriggerResolverEnabled) return
    if (record.participantId == null) return
    await chain.triggerResolver(Number(record.participantId))
  }

  private async getOfferedCredentialJson(
    credentialExchangeRecordId: string,
  ): Promise<JsonLdFormatDataVerifiableCredential> {
    const formatData = await this.agent.didcomm.credentials.getFormatData(credentialExchangeRecordId)
    const credentialJson = (
      formatData.credential as { jsonld?: JsonLdFormatDataVerifiableCredential } | undefined
    )?.jsonld
    if (!credentialJson) throw new Error('Offered credential has no JSON-LD body to verify')
    return credentialJson
  }

  private requireIndexer(): VeranaIndexerService {
    if (!this.options.indexer) {
      throw new Error('Agent has no indexer configured (set VERANA_INDEXER_BASE_URL)')
    }
    return this.options.indexer
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

  async rotateRequesterDidToPeer(connectionId: string): Promise<void> {
    await this.agent.didcomm.connections.rotate({ connectionId })
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
