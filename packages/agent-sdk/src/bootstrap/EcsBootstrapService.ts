import { BaseLogger } from '@credo-ts/core'
import {
  VtFlowApi,
  VtFlowRole,
  VtFlowState,
  VtFlowVariant,
  isVtFlowTerminalState,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { ECS, classifyEcsSchema } from '@verana-labs/vs-agent-model'

import { VsAgent } from '../agent/VsAgent'
import {
  CredentialSchemaDto,
  ParticipantDto,
  ParticipantRole,
  ParticipantState,
  VeranaChainService,
  VeranaIndexerService,
} from '../blockchain'
import { HOLDER_PARTICIPANT_TYPE, ISSUER_PARTICIPANT_TYPE } from '../types'
import { waitUntilOwnDidIsPubliclyResolvable } from '../utils/didReadiness'
import { VtFlowOrchestrator } from '../vtFlow/VtFlowOrchestrator'
import { composeEcsClaims } from '../utils/ecsClaims'

const START_OP_MSG = '/verana.pp.v1.MsgStartParticipantOP'
const SELF_CREATE_MSG = '/verana.pp.v1.MsgSelfCreateParticipant'

const ISSUER_ONBOARDING_MODE_OPEN = 1
const ISSUER_ONBOARDING_MODE_GRANTOR = 3

export interface EcsBootstrapOptions {
  mode: 'standalone' | 'delegated'
  trustedEcosystemDids?: string[]
  delegatedParentVsDid?: string
  verifyPeer?: (peerDid: string) => Promise<boolean>
}

export class EcsBootstrapService {
  constructor(
    private readonly agent: VsAgent,
    private readonly indexer: VeranaIndexerService | undefined,
    private readonly options: EcsBootstrapOptions,
    private readonly logger: BaseLogger,
  ) {}

  async run(): Promise<void> {
    // Both repair steps sign nothing on chain, so they run before any gate, in either mode, and
    // also for a deployment whose participants the Corporation operator provisions out of band.
    await this.acceptPendingOffers()
    await this.resumePendingOnboardings()

    if (this.options.mode === 'delegated') return this.runDelegated()
    return this.runStandalone()
  }

  private async runStandalone(): Promise<void> {
    const skip = await this.preflight()
    if (skip) {
      this.logger.info(
        `[EcsBootstrap] standalone bootstrap skipped: ${skip}; this agent expects its participants to be provisioned out of band`,
      )
      return
    }
    const chain = this.agent.veranaChain!
    const indexer = this.indexer!

    const { credential, credentialType, service } = await this.discoverEcsSchemas(indexer)
    await this.ensureHolderParticipant(chain, indexer, credential, credentialType)
    await this.ensureServiceIssuer(chain, indexer, service)
  }

  private async preflight(): Promise<string | null> {
    if (!this.agent.did) return 'the agent has no public DID'
    const chain = this.agent.veranaChain
    if (!chain) return 'the Verana chain is not configured'
    if (!this.indexer) return 'the Verana indexer is not configured'
    if (!this.options.trustedEcosystemDids?.length) return 'TRUSTED_ECS_ECOSYSTEM_DIDS is not set'

    return this.operatorSkipReason(chain)
  }

  // StartParticipantOP costs a trust deposit and a fee, so both the authorization and the funds
  // must be there. Neither is a misconfiguration: the operator may provision the entry itself.
  private async operatorSkipReason(chain: VeranaChainService): Promise<string | null> {
    const operatorAuths = await chain.listOperatorAuthorizations()
    if (!operatorAuths.some(auth => auth.msgTypes.includes(START_OP_MSG))) {
      return `operator ${chain.address} holds no OperatorAuthorization covering MsgStartParticipantOP`
    }
    const balance = await chain.getBalance()
    if (Number(balance.amount) === 0) {
      return `operator ${chain.address} has no ${balance.denom} balance for fees and trust deposits`
    }
    return null
  }

  // Live offers are accepted by the vt-flow autoAcceptCredentialOffer pipeline; this only
  // re-drives flows that were sitting at CRED_OFFERED when the agent restarted.
  private async acceptPendingOffers(): Promise<void> {
    const api = this.agent.dependencyManager.resolve(VtFlowApi)
    const pending = await api.findAllByQuery({
      flowState: VtFlowState.CredOffered,
      role: VtFlowRole.Applicant,
    })
    for (const record of pending) {
      if (!record.credentialExchangeRecordId) continue
      try {
        await this.agent.didcomm.credentials.acceptOffer({
          credentialExchangeRecordId: record.credentialExchangeRecordId,
        })
        this.logger.info(`[EcsBootstrap] re-accepted the pending credential offer for flow ${record.id}`)
      } catch (error) {
        this.logger.warn(
          `[EcsBootstrap] could not re-accept the offer for flow ${record.id}: ${(error as Error).message}`,
        )
      }
    }
  }

  /**
   * StartParticipantOP pays a trust deposit, and it cannot be undone. The onboarding request that
   * must follow it travels over DIDComm from the chain event handler, which catches its own
   * failure. The indexer marks that block processed all the same and never replays it, so an
   * unreachable validator leaves the entry at PENDING for ever. This boot step closes that gap.
   */
  private async resumePendingOnboardings(): Promise<void> {
    if (!this.indexer || !this.agent.did) return

    const own = await this.indexer.listParticipants({ did: this.agent.did }).catch(() => [])
    for (const participant of own) {
      if (participant.op_state !== 'PENDING' || participant.revoked || participant.slashed) continue
      try {
        await this.resumeOnboarding(participant)
      } catch (error) {
        this.logger.warn(
          `[EcsBootstrap] could not resume the onboarding of participant ${participant.id}: ${(error as Error).message}`,
        )
      }
    }
  }

  private async resumeOnboarding(participant: ParticipantDto): Promise<void> {
    // A flow that a peer ended on purpose is not an interruption; only an error deserves a retry.
    const api = this.agent.dependencyManager.resolve(VtFlowApi)
    const [latest] = (
      await api.findAllByQuery({
        participantId: String(participant.id),
        role: VtFlowRole.Applicant,
        flowVariant: VtFlowVariant.OnboardingProcess,
      })
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    if (latest && isVtFlowTerminalState(latest.state) && latest.state !== VtFlowState.Error) return

    // The agent validates its own entry when it controls the ECOSYSTEM root of the schema, so
    // there is no peer to send a request to: the interrupted step is the chain outcome itself.
    if (await this.isSelfValidated(participant)) {
      const chain = this.agent.veranaChain
      if (!chain) return
      await chain.setParticipantOPToValidated({
        id: participant.id,
        validationFees: 0,
        issuanceFees: 0,
        verificationFees: 0,
      })
      await this.triggerResolverBestEffort(chain, participant.id)
      this.logger.info(`[EcsBootstrap] validated the interrupted self-issued participant ${participant.id}`)
      return
    }

    // startOnboardingProcess writes nothing on chain, and it refuses to resend while a flow is in
    // progress, so this is safe on every boot.
    await waitUntilOwnDidIsPubliclyResolvable(this.agent, this.logger)
    const claims = await this.onboardingClaims(participant.schema_id)
    const record = await new VtFlowOrchestrator(this.agent).startOnboardingProcess({
      applicantParticipantId: participant.id,
      ...(claims ? { claims } : {}),
    })
    this.logger.info(
      `[EcsBootstrap] resumed the onboarding of participant ${participant.id} (flow ${record.id}, state ${record.state})`,
    )
  }

  private async isSelfValidated(participant: ParticipantDto): Promise<boolean> {
    if (participant.validator_participant_id == null) return false
    const validator = await this.indexer!.getParticipant(participant.validator_participant_id).catch(
      () => undefined,
    )
    return validator?.did === this.agent.did
  }

  // WL-ECS: only ecosystems on the configured allowlist may provide the essential credential schemas.
  private async discoverEcsSchemas(indexer: VeranaIndexerService): Promise<{
    credential: CredentialSchemaDto
    credentialType: ECS
    service: CredentialSchemaDto
  }> {
    const ecosystems = await indexer.listEcosystems()
    const failures: string[] = []
    for (const did of this.options.trustedEcosystemDids!) {
      const ecosystem = ecosystems.find(e => e.did === did && !e.archived)
      if (!ecosystem) {
        failures.push(`${did}: not a known active ecosystem`)
        continue
      }
      try {
        return await this.discoverFromEcosystem(indexer, ecosystem.id)
      } catch (error) {
        failures.push(`${did}: ${(error as Error).message}`)
      }
    }
    throw new Error(`no trusted ECS ecosystem is usable: ${failures.join('; ')}`)
  }

  private async discoverFromEcosystem(
    indexer: VeranaIndexerService,
    ecosystemId: number,
  ): Promise<{ credential: CredentialSchemaDto; credentialType: ECS; service: CredentialSchemaDto }> {
    const schemas = await indexer.listCredentialSchemas(ecosystemId)
    const classified = await Promise.all(
      schemas
        .filter(schema => !schema.archived)
        .map(async schema => ({ schema, type: await classifyEcsSchema(schema.json_schema) })),
    )
    const byType = (type: ECS) => classified.find(c => c.type === type)?.schema

    const service = byType(ECS.SERVICE)
    if (!service) throw new Error('no ECS Service credential schema')
    const org = byType(ECS.ORG)
    const persona = byType(ECS.PERSONA)
    const credential = org ?? persona
    if (!credential) throw new Error('no ECS Organization or Persona credential schema')
    return { credential, credentialType: org ? ECS.ORG : ECS.PERSONA, service }
  }

  private async ensureHolderParticipant(
    chain: VeranaChainService,
    indexer: VeranaIndexerService,
    schema: CredentialSchemaDto,
    credentialType: ECS,
  ): Promise<void> {
    // If this agent controls the schema's ECOSYSTEM root, it has no external ISSUER to seek a
    // HOLDER credential from — it must become the ISSUER itself (see ensureSelfIssuedParticipant).
    const ownRoot = await this.findOwnActiveRoot(indexer, schema.id)
    if (ownRoot) {
      await this.ensureSelfIssuedParticipant(chain, indexer, schema, credentialType, ownRoot)
      return
    }

    const existing = await indexer.listParticipants({
      schemaId: schema.id,
      did: this.agent.did,
      role: ParticipantRole.Holder,
    })
    const usable = existing.find(p => this.isUsableParticipant(p))
    if (usable) {
      this.logger.info(
        `[EcsBootstrap] reusing HOLDER participant ${usable.id} for the ECS ${credentialType} schema`,
      )
      return
    }

    const validator = await this.findActiveValidator(indexer, schema.id, ParticipantRole.Issuer)
    if (!validator) {
      throw new Error(`no active ISSUER found for the ECS ${credentialType} schema ${schema.id}`)
    }

    // No vs_operator on bootstrap OPs: the operator account holds the OA that signs them,
    // and the chain forbids the same account from also holding a VSOA.
    const { participantId } = await chain.startParticipantOP({
      role: HOLDER_PARTICIPANT_TYPE,
      validatorParticipantId: validator.id,
      did: this.agent.did!,
    })
    this.logger.info(
      `[EcsBootstrap] started HOLDER onboarding ${participantId} for the ECS ${credentialType} schema with validator ${validator.id}`,
    )
  }

  // Unlike findActiveValidator, this does not exclude the agent's own DID.
  private async findOwnActiveRoot(
    indexer: VeranaIndexerService,
    schemaId: number,
  ): Promise<ParticipantDto | undefined> {
    if (!this.agent.did) return undefined
    const candidates = await indexer.listParticipants({
      schemaId,
      role: ParticipantRole.Ecosystem,
      did: this.agent.did,
      participantState: ParticipantState.Active,
    })
    return candidates.find(p => !p.revoked && !p.slashed && p.did === this.agent.did)
  }

  // Self-validation is spec-legal: [MOD-PP-MSG-3-2-1] checks only the validator side, and
  // [MOD-PP-MSG-1-1] grants an ECOSYSTEM root's own operator the right to validate against it.
  private async ensureSelfIssuedParticipant(
    chain: VeranaChainService,
    indexer: VeranaIndexerService,
    schema: CredentialSchemaDto,
    credentialType: ECS,
    root: ParticipantDto,
  ): Promise<void> {
    const existing = await indexer.listParticipants({
      schemaId: schema.id,
      did: this.agent.did,
      role: ParticipantRole.Issuer,
    })
    const usable = existing.find(p => this.isUsableParticipant(p))
    if (usable) {
      this.logger.info(
        `[EcsBootstrap] reusing self-issued ISSUER participant ${usable.id} for the ECS ${credentialType} schema`,
      )
      return
    }

    const { participantId } = await chain.startParticipantOP({
      role: ISSUER_PARTICIPANT_TYPE,
      validatorParticipantId: root.id,
      did: this.agent.did!,
    })
    await chain.setParticipantOPToValidated({
      id: participantId,
      validationFees: 0,
      issuanceFees: 0,
      verificationFees: 0,
    })
    await this.triggerResolverBestEffort(chain, participantId)
    this.logger.info(
      `[EcsBootstrap] self-issued ISSUER participant ${participantId} for the ECS ${credentialType} schema (ecosystem root ${root.id})`,
    )
  }

  private async ensureServiceIssuer(
    chain: VeranaChainService,
    indexer: VeranaIndexerService,
    schema: CredentialSchemaDto,
  ): Promise<void> {
    const existing = await indexer.listParticipants({
      schemaId: schema.id,
      did: this.agent.did,
      role: ParticipantRole.Issuer,
    })
    const usable = existing.find(p => this.isUsableParticipant(p))
    if (usable) {
      this.logger.info(`[EcsBootstrap] reusing Service ISSUER participant ${usable.id}`)
      return
    }

    const onChainSchema = await chain.getCredentialSchema(schema.id)
    if (!onChainSchema) throw new Error(`Service schema ${schema.id} not found on chain`)

    if (onChainSchema.issuerOnboardingMode === ISSUER_ONBOARDING_MODE_OPEN) {
      const operatorAuths = await chain.listOperatorAuthorizations()
      if (!operatorAuths.some(a => a.msgTypes.includes(SELF_CREATE_MSG))) {
        throw new Error(
          `operator ${chain.address} has no OperatorAuthorization covering MsgSelfCreateParticipant (required for OPEN issuer onboarding)`,
        )
      }
      const root =
        (await this.findOwnActiveRoot(indexer, schema.id)) ??
        (await this.findActiveValidator(indexer, schema.id, ParticipantRole.Ecosystem))
      if (!root) throw new Error(`no active ECOSYSTEM participant found for Service schema ${schema.id}`)
      const { participantId } = await chain.selfCreateParticipant({
        role: ISSUER_PARTICIPANT_TYPE,
        validatorParticipantId: root.id,
        did: this.agent.did!,
        effectiveUntil: root.effective_until ? new Date(root.effective_until) : undefined,
      })
      await this.triggerResolverBestEffort(chain, participantId)
      this.logger.info(`[EcsBootstrap] self-created Service ISSUER participant ${participantId}`)
      return
    }

    const validatorRole =
      onChainSchema.issuerOnboardingMode === ISSUER_ONBOARDING_MODE_GRANTOR
        ? ParticipantRole.IssuerGrantor
        : ParticipantRole.Ecosystem
    const validator = await this.findActiveValidator(indexer, schema.id, validatorRole)
    if (!validator) {
      throw new Error(`no active ${validatorRole} validator found for Service schema ${schema.id}`)
    }

    const { participantId } = await chain.startParticipantOP({
      role: ISSUER_PARTICIPANT_TYPE,
      validatorParticipantId: validator.id,
      did: this.agent.did!,
    })
    this.logger.info(
      `[EcsBootstrap] started Service ISSUER onboarding ${participantId} with validator ${validator.id}`,
    )
  }

  private async findActiveValidator(
    indexer: VeranaIndexerService,
    schemaId: number,
    role: ParticipantRole,
  ): Promise<ParticipantDto | undefined> {
    const candidates = await indexer.listParticipants({
      schemaId,
      role,
      participantState: ParticipantState.Active,
    })
    return candidates.find(p => !p.revoked && !p.slashed && p.did !== this.agent.did)
  }

  private async triggerResolverBestEffort(chain: VeranaChainService, participantId: number): Promise<void> {
    try {
      await chain.triggerResolver(participantId)
    } catch (error) {
      this.logger.warn(
        `[EcsBootstrap] TriggerResolver failed for participant ${participantId}: ${(error as Error).message}`,
      )
    }
  }

  private isUsableParticipant(p: ParticipantDto): boolean {
    return (
      !p.revoked &&
      !p.slashed &&
      (p.participant_state === ParticipantState.Active ||
        p.participant_state === ParticipantState.Future ||
        p.op_state === 'PENDING')
    )
  }

  private async runDelegated(): Promise<void> {
    const parentDid = this.options.delegatedParentVsDid
    if (!parentDid) throw new Error('AGENT_DELEGATED_PARENT_VS_DID is not set')
    if (!this.agent.did) throw new Error('delegated bootstrap requires a public DID')
    if (!this.indexer) throw new Error('delegated bootstrap requires the Verana indexer')
    const chain = this.agent.veranaChain
    if (!chain) throw new Error('delegated bootstrap requires the Verana chain')
    if (!this.options.verifyPeer) {
      throw new Error(
        `cannot verify parent VS ${parentDid}: verifiable public registries are not configured (set VERANA_CHAIN_ID)`,
      )
    }

    const verified = await this.options.verifyPeer(parentDid).catch(() => false)
    if (!verified) {
      throw new Error(`parent VS ${parentDid} is not a Verifiable Service`)
    }

    const validator = await this.findParentServiceIssuer(parentDid)
    await this.assertTrustedEcosystem(validator.schema_id)

    // An existing entry means the process already ran, or the operator provisioned it.
    const own = await this.indexer.listParticipants({
      did: this.agent.did,
      role: ParticipantRole.Holder,
      schemaId: validator.schema_id,
    })
    const existing = own.find(participant => this.isUsableParticipant(participant))
    if (existing) {
      // The parent named by AGENT_DELEGATED_PARENT_VS_DID must be the validator of the entry;
      // any other validator would issue the Service credential of another accountable party.
      if (Number(existing.validator_participant_id) !== validator.id) {
        throw new Error(
          `HOLDER participant ${existing.id} for the ECS Service schema ${validator.schema_id} names validator ${existing.validator_participant_id}, not the parent VS ${parentDid} (validator ${validator.id})`,
        )
      }
      this.logger.info(
        `[EcsBootstrap] HOLDER participant ${existing.id} for the ECS Service schema ${validator.schema_id} already exists; the onboarding process continues on its own`,
      )
      return
    }

    // [VSA-VTI-FLOW-OP-NEW] step 1: the applicant submits StartParticipantOP. The agent then
    // reacts to its own chain event and sends the onboarding request, so nothing is awaited here.
    // Direct Issuance does not apply: it needs holder_onboarding_mode = PERMISSIONLESS, and the
    // ECS Service schema uses ISSUER_ONBOARDING_PROCESS.
    const skip = await this.operatorSkipReason(chain)
    if (skip) {
      this.logger.info(
        `[EcsBootstrap] delegated bootstrap skipped: ${skip}; this agent expects its HOLDER participant to be provisioned out of band, with validator ${validator.id}`,
      )
      return
    }

    const { participantId } = await chain.startParticipantOP({
      role: HOLDER_PARTICIPANT_TYPE,
      validatorParticipantId: validator.id,
      did: this.agent.did,
    })
    this.logger.info(
      `[EcsBootstrap] started HOLDER onboarding ${participantId} for the ECS Service schema ${validator.schema_id} with parent VS ${parentDid} (validator ${validator.id})`,
    )
  }

  private async findParentServiceIssuer(parentDid: string): Promise<ParticipantDto> {
    const participants = await this.indexer!.listParticipants({
      did: parentDid,
      role: ParticipantRole.Issuer,
      participantState: ParticipantState.Active,
    })
    for (const participant of participants) {
      if (participant.revoked || participant.slashed) continue
      const schema = await this.indexer!.getCredentialSchema(participant.schema_id).catch(() => undefined)
      if (!schema) continue
      if ((await classifyEcsSchema(schema.json_schema)) === ECS.SERVICE) return participant
    }
    throw new Error(`parent VS ${parentDid} holds no active ISSUER participant for an ECS Service schema`)
  }

  // WL-ECS: an allowlist is optional in delegated mode, but it binds the flow once the operator sets it.
  private async assertTrustedEcosystem(schemaId: number): Promise<void> {
    const trusted = this.options.trustedEcosystemDids
    if (!trusted?.length) return

    const schema = await this.indexer!.getCredentialSchema(schemaId).catch(() => undefined)
    const ecosystem = schema
      ? await this.indexer!.getEcosystem(schema.ecosystem_id).catch(() => undefined)
      : undefined
    if (!ecosystem || ecosystem.archived || !trusted.includes(ecosystem.did)) {
      throw new Error(
        `the ECS Service schema ${schemaId} belongs to ecosystem ${ecosystem?.did ?? '<unresolvable>'}, which TRUSTED_ECS_ECOSYSTEM_DIDS does not list`,
      )
    }
  }

  private async onboardingClaims(schemaId: number): Promise<Record<string, unknown> | undefined> {
    if (!this.agent.ecsClaims || !this.agent.did) return undefined
    const schema = await this.agent.indexer.getCredentialSchema(schemaId)
    const ecsKey = schema && (await classifyEcsSchema(schema.json_schema))
    if (!ecsKey) {
      this.agent.config.logger.warn(`[ecs-claims] schema ${schemaId} is not an ECS schema, sending no claims`)
      return undefined
    }
    return await composeEcsClaims(this.agent.ecsClaims, ecsKey, this.agent.config.logger)
  }
}
