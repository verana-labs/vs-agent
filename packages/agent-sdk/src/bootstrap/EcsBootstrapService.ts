import { BaseLogger } from '@credo-ts/core'
import {
  VtFlowApi,
  VtFlowEventTypes,
  VtFlowRole,
  VtFlowState,
  type VtFlowStateChangedEvent,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { ECS, identifySchema } from '@verana-labs/vs-agent-model'

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

const START_OP_MSG = '/verana.pp.v1.MsgStartParticipantOP'
const SELF_CREATE_MSG = '/verana.pp.v1.MsgSelfCreateParticipant'

const ISSUER_ONBOARDING_MODE_OPEN = 1
const ISSUER_ONBOARDING_MODE_GRANTOR = 3

const ECS_TITLE_BY_TYPE: Record<string, ECS> = {
  ServiceCredential: ECS.SERVICE,
  OrganizationCredential: ECS.ORG,
  PersonaCredential: ECS.PERSONA,
  UserAgentCredential: ECS.USER_AGENT,
}

const DELEGATED_OUTCOME_TIMEOUT_MS = 15 * 60_000

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
    if (this.options.mode === 'delegated') return this.runDelegated()
    return this.runStandalone()
  }

  private async runStandalone(): Promise<void> {
    const skip = await this.preflight()
    if (skip) {
      this.logger.info(`[EcsBootstrap] standalone bootstrap skipped: ${skip}`)
      return
    }
    const chain = this.agent.veranaChain!
    const indexer = this.indexer!

    await this.acceptPendingOffers()
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

    const operatorAuths = await chain.listOperatorAuthorizations()
    if (!operatorAuths.some(a => a.msgTypes.includes(START_OP_MSG))) {
      return `operator ${chain.address} has no OperatorAuthorization covering MsgStartParticipantOP`
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
        .map(async schema => ({ schema, type: await this.classifySchema(schema) })),
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

  private async classifySchema(schema: CredentialSchemaDto): Promise<ECS | null> {
    try {
      const parsed = JSON.parse(schema.json_schema) as Record<string, unknown>
      const byDigest = await identifySchema(parsed)
      if (byDigest) return byDigest
      const title = typeof parsed.title === 'string' ? parsed.title : ''
      return ECS_TITLE_BY_TYPE[title] ?? null
    } catch {
      return null
    }
  }

  private async ensureHolderParticipant(
    chain: VeranaChainService,
    indexer: VeranaIndexerService,
    schema: CredentialSchemaDto,
    credentialType: ECS,
  ): Promise<void> {
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
      const root = await this.findActiveValidator(indexer, schema.id, ParticipantRole.Ecosystem)
      if (!root) throw new Error(`no active ECOSYSTEM participant found for Service schema ${schema.id}`)
      const { participantId } = await chain.selfCreateParticipant({
        role: ISSUER_PARTICIPANT_TYPE,
        validatorParticipantId: root.id,
        did: this.agent.did!,
        effectiveUntil: root.effective_until ? new Date(root.effective_until) : undefined,
      })
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
    if (!this.options.verifyPeer) {
      throw new Error(
        `cannot verify parent VS ${parentDid}: verifiable public registries are not configured (set VERANA_CHAIN_ID)`,
      )
    }

    const verified = await this.options.verifyPeer(parentDid).catch(() => false)
    if (!verified) {
      throw new Error(`parent VS ${parentDid} is not a Verifiable Service`)
    }

    const schemaId = await this.findParentServiceSchemaId(parentDid)

    let connectionId: string
    try {
      const { connectionRecord } = await this.agent.didcomm.oob.receiveImplicitInvitation({
        did: parentDid,
        ourDid: this.agent.did,
        label: this.agent.label,
        didCommVersion: 'v2',
      })
      if (!connectionRecord) throw new Error('no connection record returned')
      const ready = await this.agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id)
      connectionId = ready.id
    } catch (error) {
      throw new Error(`parent VS ${parentDid} is unreachable: ${(error as Error).message}`)
    }

    const api = this.agent.dependencyManager.resolve(VtFlowApi)
    const record = await api.sendIssuanceRequest({
      connectionId,
      schemaId: String(schemaId),
      agentParticipantId: '0',
      walletAgentParticipantId: '0',
    })
    this.logger.info(
      `[EcsBootstrap] requested the Service credential (schema ${schemaId}) from parent VS ${parentDid}`,
    )

    await this.awaitDelegatedOutcome(record.id, parentDid)
  }

  private async findParentServiceSchemaId(parentDid: string): Promise<number> {
    const participants = await this.indexer!.listParticipants({
      did: parentDid,
      role: ParticipantRole.Issuer,
      participantState: ParticipantState.Active,
    })
    for (const participant of participants) {
      const schema = await this.indexer!.getCredentialSchema(participant.schema_id).catch(() => undefined)
      if (!schema) continue
      if ((await this.classifySchema(schema)) === ECS.SERVICE) return schema.id
    }
    throw new Error(`parent VS ${parentDid} holds no active ISSUER participant for an ECS Service schema`)
  }

  private awaitDelegatedOutcome(recordId: string, parentDid: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`parent VS ${parentDid} did not complete the issuance in time`))
      }, DELEGATED_OUTCOME_TIMEOUT_MS)
      timer.unref()
      this.agent.events.on<VtFlowStateChangedEvent>(VtFlowEventTypes.VtFlowStateChanged, ({ payload }) => {
        if (payload.vtFlowRecordId !== recordId) return
        if (payload.state === VtFlowState.Completed) {
          clearTimeout(timer)
          resolve()
        } else if (
          payload.state === VtFlowState.TerminatedByValidator ||
          payload.state === VtFlowState.Error
        ) {
          clearTimeout(timer)
          reject(new Error(`parent VS ${parentDid} rejected the Service credential request`))
        }
      })
    })
  }
}
