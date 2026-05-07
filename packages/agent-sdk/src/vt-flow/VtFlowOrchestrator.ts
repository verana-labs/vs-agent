import {
  JsonObject,
  utils,
  JsonTransformer,
  W3cCredential,
  W3cJsonLdVerifiableCredential,
} from '@credo-ts/core'
import { DidCommHandshakeProtocol, type JsonCredential } from '@credo-ts/didcomm'
import { VtFlowApi, VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'

import { VsAgent } from '../agent'
import { IndexerActivity, VeranaIndexerService } from '../blockchain'
import { IndexerEventHandler, IndexerHandlerRegistry, upsertPermission } from '../blockchain/handlers'
import { createCredential, generateDigestSRI, getVerificationMethodId, signerW3c } from '../utils/setupSelfTr'
import { createVtc } from '../utils/trustCredentialStore'

import { EcsSchemaKind, ValidateFlowOptions, VtFlowClaimsConfig, VtFlowSetupOptions } from './types'

export class VtFlowOrchestrator {
  private readonly claims: VtFlowClaimsConfig
  private readonly indexer: VeranaIndexerService

  public constructor(
    private readonly agent: VsAgent,
    options: VtFlowSetupOptions,
  ) {
    this.claims = options.claims
    this.indexer = options.indexer
  }

  public async onApplicantPermStarted(activity: IndexerActivity): Promise<void> {
    if (activity.changes['did'] !== this.agent.did) return

    const validatorPermId = Number(activity.changes['validator_perm_id'])
    if (!Number.isFinite(validatorPermId)) return

    const validatorPerm = await this.indexer.getPermission(validatorPermId)
    if (!validatorPerm || validatorPerm.perm_state !== 'ACTIVE' || !validatorPerm.did) return

    const schemaKind = this.detectSchemaKind(validatorPerm.schema_id)
    const claims = (this.claims[schemaKind] ?? {}) as JsonObject

    const { connectionRecord } = await this.agent.didcomm.oob.receiveImplicitInvitation({
      did: validatorPerm.did,
      label: this.agent.label,
      handshakeProtocols: [DidCommHandshakeProtocol.Connections],
    })
    if (!connectionRecord) return
    const connection = await this.agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id)

    const vtFlowApi = this.agent.dependencyManager.resolve(VtFlowApi)
    await vtFlowApi.sendValidationRequest({
      connectionId: connection.id,
      permId: String(activity.entity_id),
      sessionUuid: utils.uuid(),
      agentPermId: '0',
      walletAgentPermId: '0',
      claims,
    })
  }

  public async validateFlow(sessionUuid: string, options: ValidateFlowOptions): Promise<void> {
    const vtFlowApi = this.agent.dependencyManager.resolve(VtFlowApi)
    const records = await vtFlowApi.findAllByQuery({ sessionUuid, role: VtFlowRole.Validator })
    const record = records[0]
    if (!record) throw new Error(`No validator record for sessionUuid=${sessionUuid}`)
    if (record.state !== VtFlowState.AwaitingVr) {
      throw new Error(`Record is in ${record.state}; expected AwaitingVr`)
    }
    if (!record.permId) throw new Error('Record has no permId')

    const holderPerm = await this.indexer.getPermission(Number(record.permId))
    if (!holderPerm?.did) throw new Error('Holder perm not found or no DID')

    if (!this.agent.did) throw new Error('Agent has no DID')
    const didRecords = await this.agent.dids.getCreatedDids({ did: this.agent.did })
    const didRecord = didRecords[0]
    if (!didRecord) throw new Error('Agent DID record not found')
    const verificationMethodId = getVerificationMethodId(this.agent.config.logger, didRecord)

    const claims = (record.claims ?? {}) as JsonObject
    const unsigned = createCredential({
      id: `${this.agent.did}#${utils.uuid()}`,
      type: ['VerifiableCredential', 'VerifiableTrustCredential'],
      issuer: this.agent.did,
      credentialSubject: { id: holderPerm.did, claims },
    })
    unsigned.credentialSchema = { id: options.credentialSchemaCredentialId, type: 'JsonSchemaCredential' }

    const signed = await signerW3c(
      this.agent,
      JsonTransformer.fromJSON(unsigned, W3cCredential),
      verificationMethodId,
    )
    const digest = generateDigestSRI(JSON.stringify(signed.jsonCredential))

    if (!this.agent.veranaChain) throw new Error('Agent not connected to Verana chain')
    await this.agent.veranaChain.setPermissionVPToValidated({
      id: Number(record.permId),
      vpSummaryDigest: digest,
    })
    await this.agent.veranaChain.createOrUpdatePermissionSession({
      id: record.sessionUuid,
      agentPermId: 0,
      walletAgentPermId: 0,
      digest,
    })

    await vtFlowApi.acceptValidationRequest(record.id)
    await vtFlowApi.markValidated(record.id)

    await vtFlowApi.offerCredentialForSession({
      vtFlowRecordId: record.id,
      credentialFormats: {
        jsonld: {
          credential: signed.jsonCredential as unknown as JsonCredential,
          options: { proofType: 'Ed25519Signature2020', proofPurpose: 'assertionMethod' },
        },
      },
    })
  }

  public async acceptCredential(sessionUuid: string): Promise<void> {
    const vtFlowApi = this.agent.dependencyManager.resolve(VtFlowApi)
    const records = await vtFlowApi.findAllByQuery({ sessionUuid, role: VtFlowRole.Applicant })
    const record = records[0]
    if (!record) throw new Error(`No applicant record for sessionUuid=${sessionUuid}`)
    if (record.state !== VtFlowState.CredOffered) {
      throw new Error(`Record is in ${record.state}; expected CredOffered`)
    }

    await this.verifyOfferedCredential(record)

    const updated = await vtFlowApi.acceptReceivedCredential(record.id)
    await this.publishLinkedVpForEcs(updated)
  }

  // TODO: real schema-kind detection. For now defaults to 'organization'.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private detectSchemaKind(_schemaId: number): EcsSchemaKind {
    return 'organization'
  }

  private async publishLinkedVpForEcs(record: { credentialExchangeRecordId?: string }): Promise<void> {
    if (!record.credentialExchangeRecordId) return
    try {
      const fmt = await this.agent.didcomm.credentials.getFormatData(record.credentialExchangeRecordId)
      const credentialJson = fmt.credential?.jsonld
      if (!credentialJson) return
      const schemaRef = (credentialJson.credentialSchema as { id?: string } | undefined)?.id
      const schemaBaseId = schemaRef && /schemas-([a-z0-9-]+?)-(?:jsc|c-vp)\.json/i.exec(schemaRef)?.[1]
      if (!schemaBaseId) return
      const cred = JsonTransformer.fromJSON(credentialJson, W3cJsonLdVerifiableCredential)
      await createVtc(this.agent, this.agent.publicApiBaseUrl, schemaBaseId.toLowerCase(), cred)
    } catch (error) {
      this.agent.config.logger.error(`[vt-flow] Linked VP publish failed: ${String(error)}`)
    }
  }

  private async verifyOfferedCredential(record: {
    permId?: string
    credentialExchangeRecordId?: string
  }): Promise<void> {
    if (!record.credentialExchangeRecordId) throw new Error('Record has no credentialExchangeRecordId')
    if (!record.permId) throw new Error('Record has no permId')

    const fmt = await this.agent.didcomm.credentials.getFormatData(record.credentialExchangeRecordId)
    const credentialJson = fmt.credential?.jsonld
    if (!credentialJson) throw new Error('No JSON-LD credential on the offer')

    // 1. Validator authorization: holder perm's validator_perm_id must be ACTIVE.
    const holderPerm = await this.indexer.getPermission(Number(record.permId))
    if (!holderPerm) throw new Error(`Holder perm ${record.permId} not found on indexer`)
    if (holderPerm.validator_perm_id == null) throw new Error('Holder perm has no validator_perm_id')

    const validatorPerm = await this.indexer.getPermission(Number(holderPerm.validator_perm_id))
    if (!validatorPerm || validatorPerm.perm_state !== 'ACTIVE') {
      throw new Error('Validator permission is not active')
    }

    // 2. Digest match: recompute SRI of received credential, compare with on-chain digest.
    const computed = generateDigestSRI(JSON.stringify(credentialJson))
    if (!holderPerm.vp_summary_digest || holderPerm.vp_summary_digest !== computed) {
      throw new Error(`Digest mismatch: computed=${computed} on-chain=${holderPerm.vp_summary_digest}`)
    }
  }
}

function buildVtFlowEventHandlers(orchestrator: VtFlowOrchestrator): IndexerEventHandler[] {
  return [
    {
      msg: 'StartPermissionVP',
      handle: async (activity, ctx) => {
        upsertPermission(ctx.state, activity, { vpState: 'PENDING' })
        ctx.agent.config.logger.info(`[vt-flow] StartPermissionVP entity=${activity.entity_id}`)
        await orchestrator.onApplicantPermStarted(activity)
      },
    },
  ]
}

export function setupVtFlowOrchestrator(
  agent: VsAgent,
  registry: IndexerHandlerRegistry,
  options: VtFlowSetupOptions,
): VtFlowOrchestrator {
  const orchestrator = new VtFlowOrchestrator(agent, options)
  buildVtFlowEventHandlers(orchestrator).forEach(handler => registry.register(handler))
  return orchestrator
}
