import type { JsonObject, W3cVerifiableCredential } from '@credo-ts/core'

import {
  JsonTransformer,
  W3cJsonLdVerifiableCredential,
  W3cV2DataIntegrityVerifiableCredential,
  utils,
} from '@credo-ts/core'
import type { DataIntegrityCredential, DidCommDataIntegrityOfferCredentialFormat } from '@credo-ts/didcomm'
import {
  VtFlowApi,
  VtFlowRecord,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
  isVtFlowTerminalState,
  type VtFlowEcsIssuanceExemptionContext,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { computeCredentialDigestJCS } from '@verana-labs/verre'
import { ECS, classifyEcsSchema } from '@verana-labs/vs-agent-model'

import { BaseAgentModules, VsAgent } from '../agent'
import { isEcsIssuanceExempt } from './ecsIssuanceExemption'
import { Participant, ParticipantRole, ParticipantState } from '../blockchain/types'
import {
  HOLDER_PARTICIPANT_TYPE,
  ISSUER_GRANTOR_PARTICIPANT_TYPE,
  ISSUER_PARTICIPANT_TYPE,
  VERIFIER_GRANTOR_PARTICIPANT_TYPE,
  VERIFIER_PARTICIPANT_TYPE,
} from '../types'
import {
  connectToPublicDid,
  createVtc,
  createW3cV2Credential,
  isVcdm2Credential,
  linkedVpSchemaId,
  removeStoredTrustCredential,
  resolveJsonSchemaCredentialId,
  toOfferedCredentialJson,
  validateSchema,
} from '../utils'

export interface VtFlowOrchestratorOptions {
  publicApiBaseUrl?: string
  agentParticipantId?: number
  walletAgentParticipantId?: number
}

export interface StartOnboardingProcessInput {
  applicantParticipantId: number
  participantSessionId?: string
  claims?: Record<string, unknown>
}

export interface ValidateOnboardingProcessInput {
  vtFlowRecordId: string
  /** Only for a HOLDER. It defaults to the schema of the applicant participant. */
  credentialSchemaId?: string
  credentialType?: string[]
  credentialContext?: string[]
}

export interface OfferOnboardingCredentialInput {
  vtFlowRecordId: string
  /** The credential validateOnboardingProcess built. Without it the method builds one. */
  credential?: JsonObject
  /** It defaults to the schema of the applicant participant. */
  credentialSchemaId?: string
  /** The participant validateOnboardingProcess returned; saves a second chain read. */
  participant?: Participant
  credentialType?: string[]
  credentialContext?: string[]
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
    this.requireChain()
    if (!this.agent.did) throw new Error('Agent has no public DID')

    const holderParticipant = await this.agent.indexer.findParticipant(input.applicantParticipantId)
    if (!holderParticipant) {
      throw new Error(`Applicant participant ${input.applicantParticipantId} not found on chain`)
    }
    if (holderParticipant.did !== this.agent.did) {
      throw new Error(`Applicant participant ${input.applicantParticipantId} does not belong to this agent`)
    }
    const applicantRoles = [
      ISSUER_PARTICIPANT_TYPE,
      VERIFIER_PARTICIPANT_TYPE,
      ISSUER_GRANTOR_PARTICIPANT_TYPE,
      VERIFIER_GRANTOR_PARTICIPANT_TYPE,
      HOLDER_PARTICIPANT_TYPE,
    ]
    if (!applicantRoles.includes(Number(holderParticipant.role))) {
      throw new Error(`Participant ${input.applicantParticipantId} has no applicant-capable role`)
    }
    if (!holderParticipant.validatorParticipantId) {
      throw new Error(`Applicant participant ${input.applicantParticipantId} has no validator_participant_id`)
    }

    const validatorParticipant = await this.agent.indexer.findParticipant(
      Number(holderParticipant.validatorParticipantId),
    )
    if (!validatorParticipant?.did) {
      throw new Error(`Validator participant ${holderParticipant.validatorParticipantId} not resolvable`)
    }
    if (validatorParticipant.revoked || validatorParticipant.slashed) {
      throw new Error(`Validator participant ${validatorParticipant.id} is not active`)
    }

    // Renewals resend the OR with the same session id so the validator re-attaches the finished flow.
    const vtFlowApi = this.resolveVtFlowApi()
    const [latest] = (
      await vtFlowApi.findAllByQuery({
        participantId: String(holderParticipant.id),
        role: VtFlowRole.Applicant,
        flowVariant: VtFlowVariant.OnboardingProcess,
      })
    )
      .filter(record => !isVtFlowTerminalState(record.state))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    if (latest && latest.state !== VtFlowState.Completed && latest.state !== VtFlowState.CredRevoked) {
      this.agent.config.logger.info(
        `[vt-flow] onboarding flow ${latest.id} for participant ${holderParticipant.id} is already in progress (state ${latest.state}); not resending`,
      )
      return latest
    }
    const existing = latest

    let connectionId: string | undefined
    if (existing) {
      const connection = await this.agent.didcomm.connections.findById(existing.connectionId)
      if (connection?.isReady) connectionId = connection.id
    }
    if (!connectionId) {
      connectionId = await connectToPublicDid(this.agent, validatorParticipant.did)
    }

    return vtFlowApi.sendOnboardingRequest({
      connectionId,
      participantSessionId: input.participantSessionId ?? existing?.participantSessionId ?? utils.uuid(),
      participantId: String(holderParticipant.id),
      agentParticipantId: String(this.options.agentParticipantId ?? 0),
      walletAgentParticipantId: String(this.options.walletAgentParticipantId ?? 0),
      claims: input.claims,
    })
  }

  /**
   * Validate an onboarding process: record the outcome on-chain, accept the onboarding request and
   * move the record to VALIDATED. It sends no credential. Only a HOLDER takes part in a credential
   * exchange; an ISSUER, a VERIFIER or a grantor joins the Ecosystem, and SetParticipantOPToValidated
   * is the whole of it. The caller decides what follows, from the role of the returned participant.
   *
   * For a HOLDER it builds the credential before the chain write, and returns it for
   * offerOnboardingCredential. Claims that do not satisfy the schema, or a schema fetch that fails,
   * must stop the process while the chain holds no outcome yet and the caller can repeat the call.
   *
   * A record that is already VALIDATED and has no credential exchange keeps the chain outcome and
   * only builds the credential again. A repeat call thus re-drives an offer that did not complete.
   */
  async validateOnboardingProcess(
    input: ValidateOnboardingProcessInput,
  ): Promise<{ record: VtFlowRecord; participant: Participant; credential?: JsonObject }> {
    const chain = this.requireChain()
    if (!this.agent.did) throw new Error('Agent has no public DID')

    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(input.vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${input.vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Validator) throw new Error('Record is not validator-side')
    if (record.variant !== VtFlowVariant.OnboardingProcess) {
      throw new Error(`Record variant is '${record.variant}', expected OnboardingProcess`)
    }
    const resumeOffer = record.state === VtFlowState.Validated && !record.credentialExchangeRecordId
    if (record.state !== VtFlowState.AwaitingOr && !resumeOffer) {
      throw new Error(
        `Record state is '${record.state}', expected '${VtFlowState.AwaitingOr}', or ` +
          `'${VtFlowState.Validated}' with no credential exchange`,
      )
    }
    if (!record.participantId) throw new Error('Record has no participantId')

    const participantId = Number(record.participantId)
    const participant = await this.agent.indexer.findParticipant(participantId)
    if (!participant) throw new Error(`Applicant participant ${participantId} not found on chain`)
    if (!participant.did) throw new Error('Applicant participant has no DID')

    const credential =
      Number(participant.role) === HOLDER_PARTICIPANT_TYPE
        ? await this.buildCredential({
            credentialSchemaId: input.credentialSchemaId ?? String(participant.schemaId),
            subjectDid: participant.did,
            claims: (record.claims ?? {}) as JsonObject,
            credentialType: input.credentialType,
            credentialContext: input.credentialContext,
          })
        : undefined

    if (resumeOffer) return { record, participant, credential }

    // op_summary_digest (MOD-PP-MSG-3) digests the applicant's submission, not the credential
    await chain.setParticipantOPToValidated({ id: participantId, corporation: participant.corporation })

    await vtFlowApi.acceptOnboardingRequest(record.id)
    const validated = await vtFlowApi.markValidated(record.id)
    return { record: validated, participant, credential }
  }

  /**
   * Offer the credential of an onboarding process to its applicant. Call it only for a HOLDER, and
   * only after validateOnboardingProcess has moved the record to VALIDATED. Give it the credential
   * that validateOnboardingProcess built, so that the process does not build the credential twice.
   */
  async offerOnboardingCredential(input: OfferOnboardingCredentialInput): Promise<VtFlowRecord> {
    this.requireChain()
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(input.vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${input.vtFlowRecordId} not found`)
    if (!record.participantId) throw new Error('Record has no participantId')

    const participant =
      input.participant ?? (await this.agent.indexer.findParticipant(Number(record.participantId)))
    if (!participant?.did) throw new Error('Applicant participant has no DID')

    const unsignedCredentialJson =
      input.credential ??
      (await this.buildCredential({
        credentialSchemaId: input.credentialSchemaId ?? String(participant.schemaId),
        subjectDid: participant.did,
        claims: (record.claims ?? {}) as JsonObject,
        credentialType: input.credentialType,
        credentialContext: input.credentialContext,
      }))

    // W3C Data Integrity attachment format (RFC 0809). The applicant DID is the credential subject
    // and the exchange runs over its authenticated connection, so no extra binding is required. The
    // cryptosuite is the issuer's choice and is applied when the credential is issued.
    const { record: offered } = await vtFlowApi.offerCredentialForSession({
      vtFlowRecordId: record.id,
      issuerParticipantId: Number(participant.validatorParticipantId),
      credentialFormats: {
        dataIntegrity: { credential: unsignedCredentialJson, bindingRequired: false },
      },
    })
    return offered
  }

  /**
   * Close an onboarding process that carries no credential exchange, on the validator side. The
   * applicant reaches the same state from the SetParticipantOPToValidated chain event.
   */
  async completeOnboardingProcess(vtFlowRecordId: string): Promise<VtFlowRecord> {
    return this.resolveVtFlowApi().markCompleted(vtFlowRecordId)
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

  async buildDirectIssuanceOffer(vtFlowRecordId: string): Promise<{
    credentialFormats: { dataIntegrity: DidCommDataIntegrityOfferCredentialFormat }
    issuerParticipantId: number
  } | null> {
    const chain = this.requireChain()
    if (!this.agent.did) throw new Error('Agent has no public DID')
    const indexer = this.agent.indexer

    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Validator || record.variant !== VtFlowVariant.DirectIssuance) {
      return null
    }
    if (!record.schemaId) throw new Error('Record has no schemaId')

    const issuers = await indexer.listParticipants({
      did: this.agent.did,
      schemaId: Number(record.schemaId),
      role: ParticipantRole.Issuer,
      participantState: ParticipantState.Active,
    })
    const issuer = issuers.find(p => !p.revoked && !p.slashed && p.vs_operator === chain.address)
    if (!issuer) {
      this.agent.config.logger.warn(
        `[vt-flow] no active issuer participant with vs_operator ${chain.address} for schema ${record.schemaId}; not offering`,
      )
      return null
    }

    const connection = await this.agent.didcomm.connections.findById(record.connectionId)
    if (!connection?.theirDid) throw new Error('Flow connection has no peer DID')

    const unsignedCredentialJson = await this.buildCredential({
      credentialSchemaId: String(record.schemaId),
      subjectDid: connection.theirDid,
      claims: (record.claims ?? {}) as JsonObject,
    })

    return {
      credentialFormats: {
        dataIntegrity: { credential: unsignedCredentialJson, bindingRequired: false },
      },
      issuerParticipantId: issuer.id,
    }
  }

  /**
   * Builds the unsigned VC Data Model 2.0 credential that goes into the offer. RFC 0809 derives the
   * advertised data model version from its context, and the issuer secures it with a
   * DataIntegrityProof once the applicant requests it.
   */
  private async buildCredential(input: {
    credentialSchemaId: string
    subjectDid: string
    claims: JsonObject
    credentialType?: string[]
    credentialContext?: string[]
  }): Promise<JsonObject> {
    const jsonSchemaCredentialId = await this.resolveJsonSchemaCredentialId(input.credentialSchemaId)

    // A credential whose claims don't satisfy the schema's required fields is not a valid
    // instance of that credential type — reject it here rather than issue an empty shell.
    const schema = await this.agent.indexer.getCredentialSchema(input.credentialSchemaId)
    validateSchema(JSON.parse(schema.json_schema), { id: input.subjectDid, ...input.claims })

    // Data model 2.0 holds the claims on the credential subject itself; the applicant DID wins over
    // any `id` claim so the credential can never name a different subject
    const unsignedCredential = createW3cV2Credential({
      id: `${this.agent.did}#${utils.uuid()}`,
      type: input.credentialType ?? ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: this.agent.did!,
      context: input.credentialContext,
      credentialSubject: { ...input.claims, id: input.subjectDid },
      credentialSchema: { id: jsonSchemaCredentialId, type: 'JsonSchemaCredential' },
    })

    return toOfferedCredentialJson(unsignedCredential)
  }

  private async resolveJsonSchemaCredentialId(credentialSchemaId: string): Promise<string> {
    return resolveJsonSchemaCredentialId(
      this.agent,
      this.agent.indexer,
      credentialSchemaId,
      this.requireChain().getChainId,
    )
  }

  /** Per the spec the algorithm comes from the schema, never from the digest value. */
  private async digestAlgorithmForSchema(schemaId: number): Promise<string> {
    return (await this.credentialSchema(schemaId)).digestAlgorithm
  }

  private async credentialSchema(schemaId: number): Promise<{ digestAlgorithm: string; ecsKey: ECS | null }> {
    const schema = await this.agent.indexer.getCredentialSchema(schemaId)
    if (!schema.digest_algorithm) {
      throw new Error(`Credential schema ${schemaId} has no digest_algorithm`)
    }
    return { digestAlgorithm: schema.digest_algorithm, ecsKey: await classifyEcsSchema(schema.json_schema) }
  }

  /** Fired after signing and before delivery, so a failure here must abort the issuance. */
  async onCredentialIssued(
    vtFlowRecordId: string,
    signedCredential: Record<string, unknown>,
  ): Promise<string> {
    const chain = this.requireChain()
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.issuerParticipantId == null) {
      throw new Error(`vt-flow record ${vtFlowRecordId} has no issuerParticipantId to anchor against`)
    }

    const issuer = await this.agent.indexer.getParticipant(record.issuerParticipantId)
    const algorithm = await this.digestAlgorithmForSchema(issuer.schema_id)
    const digest = computeCredentialDigestJCS(
      signedCredential as unknown as W3cVerifiableCredential,
      algorithm,
    )
    await chain.createOrUpdateParticipantSession({
      id: record.participantSessionId,
      issuerParticipantId: record.issuerParticipantId,
      agentParticipantId: Number(record.agentParticipantId ?? 0) || 0,
      walletAgentParticipantId: Number(record.walletAgentParticipantId ?? 0) || 0,
      digest,
    })
    return digest
  }

  async verifyOfferedCredential(vtFlowRecordId: string): Promise<void> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record) throw new Error(`vt-flow record ${vtFlowRecordId} not found`)
    if (record.role !== VtFlowRole.Applicant) throw new Error('Record is not applicant-side')
    if (!record.credentialExchangeRecordId) {
      throw new Error('Record has no credentialExchangeRecordId; nothing to verify')
    }
    const indexer = this.agent.indexer

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

    const credentialJson = await this.getReceivedCredentialJson(record.credentialExchangeRecordId)
    const { digestAlgorithm, ecsKey } = await this.credentialSchema(issuer.schema_id)
    const digest = computeCredentialDigestJCS(
      credentialJson as unknown as W3cVerifiableCredential,
      digestAlgorithm,
    )
    const anchored = await indexer.getDigest(digest)
    if (!anchored) {
      throw new Error(`Credential digest ${digest} is not anchored on-chain`)
    }
    if (ecsKey) await vtFlowApi.setEcsSchemaKey(record.id, ecsKey)
  }

  async onCredentialRevoked(vtFlowRecordId: string): Promise<void> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(vtFlowRecordId)
    if (!record || record.role !== VtFlowRole.Applicant) return
    if (!this.options.publicApiBaseUrl || !record.credentialExchangeRecordId) return

    const credentialId = await removeStoredTrustCredential(this.agent, record.credentialExchangeRecordId)
    if (credentialId) {
      this.agent.config.logger.info(
        `[vt-flow] removed revoked credential and its linked VP (${credentialId})`,
      )
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

  /** The signed credential as the issuer attached it, which is the exact JSON its digest covers. */
  private async getReceivedCredentialJson(credentialExchangeRecordId: string): Promise<JsonObject> {
    const formatData = await this.agent.didcomm.credentials.getFormatData(credentialExchangeRecordId)
    const credentialJson = (formatData.credential as { dataIntegrity?: DataIntegrityCredential } | undefined)
      ?.dataIntegrity?.credential
    if (!credentialJson) throw new Error('Received credential has no data integrity credential body')
    return credentialJson
  }

  // VS-CONN-VS gate: consulted only after trust resolution rejected the peer.
  async checkEcsIssuanceExemption(context: VtFlowEcsIssuanceExemptionContext): Promise<boolean> {
    return isEcsIssuanceExempt(
      {
        indexer: this.agent.indexer,
        agent: this.agent,
        trustedEcosystemDids: this.agent.trustedEcosystemDids,
      },
      context,
    )
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

    const credentialJson = await this.getReceivedCredentialJson(record.credentialExchangeRecordId)
    const schemaRef = (credentialJson as { credentialSchema?: { id?: string } }).credentialSchema?.id
    const schemaBaseId = schemaRef ? this.extractSchemaBaseId(schemaRef) : undefined
    if (!schemaBaseId) {
      throw new Error(
        `Cannot publish Linked VP: credential has no extractable schema base id (credentialSchema.id=${schemaRef ?? 'undefined'})`,
      )
    }
    // A data model 2.0 credential arrives secured with a DataIntegrityProof; a validator still on
    // data model 1.1 sends a linked data proof, and both are published the same way
    const credential = isVcdm2Credential(credentialJson)
      ? W3cV2DataIntegrityVerifiableCredential.fromObject(
          credentialJson as Parameters<typeof W3cV2DataIntegrityVerifiableCredential.fromObject>[0],
        )
      : JsonTransformer.fromJSON(credentialJson, W3cJsonLdVerifiableCredential)
    await createVtc(
      this.agent,
      this.options.publicApiBaseUrl,
      record.ecsSchemaKey ? linkedVpSchemaId(record.ecsSchemaKey) : schemaBaseId,
      credential,
    )
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
