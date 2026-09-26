import type { EncodeObject } from '@cosmjs/proto-signing'
import type { StdFee } from '@cosmjs/stargate'
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
  VtFlowSubmission,
  VtFlowTxReason,
  VtFlowTxStatus,
  VtFlowValidatedFromStates,
  VtFlowVariant,
  isVtFlowRenewable,
  isVtFlowTerminalState,
  type VtFlowEcsIssuanceExemptionContext,
  type VtFlowIssuance,
  type VtFlowTx,
  type VtFlowValidation,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { veranaTypeUrls } from '@verana-labs/verana-types'
import { computeCredentialDigestJCS } from '@verana-labs/verre'
import { ECS, classifyEcsSchema } from '@verana-labs/vs-agent-model'

import { AdminApiError, AdminApiErrorCode } from '../adminApi'
import { BaseAgentModules, VsAgent } from '../agent'
import { isEcsIssuanceExempt } from './ecsIssuanceExemption'
import {
  Participant,
  ParticipantDto,
  ParticipantRole,
  ParticipantState,
  ValidationState,
} from '../blockchain/types'
import type { FeeAllowance } from '../blockchain/VeranaChainService'
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
  isUsableConnectionTo,
  isVcdm2Credential,
  linkedVpSchemaId,
  removeStoredTrustCredential,
  resolveJsonSchemaCredentialId,
  schemaViolations,
  toOfferedCredentialJson,
  validateSchema,
} from '../utils'

// The chain carries a fee discount as an integer from 0 to 10000. The API and the indexer carry it
// as a decimal from 0 to 1, so only the message is scaled.
const DISCOUNT_SCALE = 10_000
const TX_LOOKUP_TIMEOUT_MS = 60_000
const TX_LOOKUP_INTERVAL_MS = 3_000
const FEE_DENOM = 'uvna'

const FEE_KEYS = ['validationFees', 'issuanceFees', 'verificationFees'] as const
const DISCOUNT_KEYS = ['issuanceFeeDiscount', 'verificationFeeDiscount'] as const

type ValidationTerms = Omit<VtFlowValidation, 'decidedAt' | 'submission' | 'tx'>

function invalidInput(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidInput, 400, message)
}

function invalidState(message: string): AdminApiError {
  return new AdminApiError(AdminApiErrorCode.InvalidState, 409, message)
}

// AUTHZ-CHECK-3 step 1. A record's expiration is only its budget clock, not a validity window.
function isActiveParticipant(participant: ParticipantDto): boolean {
  const now = Date.now()
  if (!participant.effective_from || Date.parse(participant.effective_from) > now) return false
  if (participant.effective_until && Date.parse(participant.effective_until) <= now) return false
  return !participant.revoked && !participant.slashed
}

function sameTerm(key: string, given: number, onEntry: number): boolean {
  const scale = (DISCOUNT_KEYS as readonly string[]).includes(key) ? DISCOUNT_SCALE : 1
  return Math.round(given * scale) === Math.round(onEntry * scale)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

export interface ValidateFlowInput {
  vtFlowRecordId: string
  validationFees?: number
  issuanceFees?: number
  verificationFees?: number
  issuanceFeeDiscount?: number
  verificationFeeDiscount?: number
  effectiveUntil?: string
  opSummaryDigest?: string
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
        applicantParticipantId: String(holderParticipant.id),
        role: VtFlowRole.Applicant,
        flowVariant: VtFlowVariant.OnboardingProcess,
      })
    )
      .filter(record => !isVtFlowTerminalState(record.state))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const running = latest !== undefined && !isVtFlowRenewable(latest)

    let connectionId: string | undefined
    if (latest) {
      const connection = await this.agent.didcomm.connections.findById(latest.connectionId)
      if (connection && isUsableConnectionTo(connection, validatorParticipant.did))
        connectionId = connection.id
    }
    const undelivered =
      running && latest.state === VtFlowState.OrSent && holderParticipant.opState === ValidationState.PENDING
    if (running && connectionId && !undelivered) {
      this.agent.config.logger.info(
        `[vt-flow] onboarding flow ${latest.id} for participant ${holderParticipant.id} is in progress (state ${latest.state}) on an open connection, not resending`,
      )
      return latest
    }
    if (!connectionId) {
      connectionId = await connectToPublicDid(this.agent, validatorParticipant.did)
    }

    if (running) {
      this.agent.config.logger.info(
        `[vt-flow] resending the onboarding request of flow ${latest.id} (state ${latest.state}) on ${connectionId === latest.connectionId ? 'its' : 'a new'} connection`,
      )
      return vtFlowApi.resendOnboardingRequest({ vtFlowRecordId: latest.id, connectionId })
    }

    return vtFlowApi.sendOnboardingRequest({
      connectionId,
      participantSessionId: input.participantSessionId ?? latest?.participantSessionId ?? utils.uuid(),
      applicantParticipantId: String(holderParticipant.id),
      applicantParticipantRole: Number(holderParticipant.role),
      validatorParticipantId: String(holderParticipant.validatorParticipantId),
      schemaId: String(holderParticipant.schemaId),
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
    if (!record.applicantParticipantId) throw new Error('Record has no applicantParticipantId')

    const participantId = Number(record.applicantParticipantId)
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
    if (!record.applicantParticipantId) throw new Error('Record has no applicantParticipantId')

    const participant =
      input.participant ?? (await this.agent.indexer.findParticipant(Number(record.applicantParticipantId)))
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

  /** [VSA-ADM-VT-FL-VALIDATE] */
  async validateFlow(input: ValidateFlowInput): Promise<VtFlowRecord> {
    this.requireChain()
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(input.vtFlowRecordId)
    if (!record) {
      throw new AdminApiError(AdminApiErrorCode.UnknownId, 404, `no flow with id "${input.vtFlowRecordId}"`)
    }
    if (record.role !== VtFlowRole.Validator) throw invalidState('validate is a validator action')
    const reissue =
      record.state === VtFlowState.CredOffered && record.issuance?.tx?.status === VtFlowTxStatus.Failed
    if (reissue && record.credentialExchangeRecordId) {
      const { record: issued } = await vtFlowApi.issueCredentialForSession({
        vtFlowRecordId: record.id,
        credentialExchangeRecordId: record.credentialExchangeRecordId,
      })
      return issued
    }
    if (record.variant === VtFlowVariant.DirectIssuance) return this.validateDirectIssuance(record)
    if (!record.applicantParticipantId) throw invalidState('the flow names no applicant participant')

    const applicant = await this.agent.indexer.getParticipant(record.applicantParticipantId)
    const entryValidated = applicant.op_state === 'VALIDATED'
    const rejectedInFlight = entryValidated && (await this.isRejectedInFlight(record))
    if (!rejectedInFlight) {
      this.assertValidateState(record, entryValidated)
      if (record.connectionTerminated)
        throw invalidState('the flow connection is TERMINATED until the applicant reconnects')
    }

    const terms = this.validationTerms(input, applicant, record)
    await this.assertClaimsAndTerm(record, applicant, terms)
    // [VSA-VTI-FLOW-OP-ISSUE-6]: the connection stays TERMINATED, so issuance waits for the applicant to reconnect
    if (rejectedInFlight) return this.markValidated(record.id, applicant)

    if (record.state === VtFlowState.AwaitingOr) await vtFlowApi.acceptOnboardingRequest(record.id)
    if (record.state === VtFlowState.OobPending) await this.sendValidating(record)

    if (record.state === VtFlowState.ValidatedPendingClaims) return this.continueAfterValidated(record.id)
    if (entryValidated) {
      if (record.state !== VtFlowState.Validated) await this.markValidated(record.id, applicant)
      return this.continueAfterValidated(record.id)
    }

    const validation: VtFlowValidation = {
      decidedAt: new Date().toISOString(),
      submission: await this.submissionPath(applicant),
      ...terms,
    }
    if (validation.submission === VtFlowSubmission.Operator) {
      return vtFlowApi.recordValidation(record.id, validation, VtFlowState.AwaitingValidationTx)
    }
    return this.submitValidation(record.id, applicant, validation)
  }

  // A Direct Issuance flow has no entry to validate, so no transaction: check the claims, then offer.
  private async validateDirectIssuance(record: VtFlowRecord): Promise<VtFlowRecord> {
    if (record.state !== VtFlowState.Validating && record.state !== VtFlowState.OobPending) {
      throw invalidState(`the flow is '${record.state}', which validate does not accept`)
    }
    if (!record.schemaId) throw invalidState('the flow names no credential schema')
    const connection = await this.agent.didcomm.connections.findById(record.connectionId)
    if (!connection?.theirDid) throw invalidState('the flow connection has no peer DID')

    const schema = await this.agent.indexer.getCredentialSchema(record.schemaId)
    this.assertClaims(schema.json_schema, connection.theirDid, record.claims)

    const vtFlowApi = this.resolveVtFlowApi()
    if (record.state === VtFlowState.OobPending) await this.sendValidating(record)

    const offer = await this.buildDirectIssuanceOffer(record.id)
    if (!offer) throw invalidState('the agent holds no active ISSUER participant for the schema of the flow')
    const { record: offered } = await vtFlowApi.offerCredentialForSession({
      vtFlowRecordId: record.id,
      ...offer,
    })
    return offered
  }

  // [VSA-ADM-VT-FL-START]: checked before the flow moves, as a failed send would leave it in VALIDATING
  private async sendValidating(record: VtFlowRecord): Promise<void> {
    const connection = await this.agent.didcomm.connections.findById(record.connectionId)
    if (!connection?.isReady) throw invalidState('the flow connection is not ESTABLISHED')
    await this.resolveVtFlowApi().sendValidating(record.id)
  }

  private assertClaims(jsonSchema: string, subjectDid: string, claims?: Record<string, unknown>): void {
    const violations = schemaViolations(JSON.parse(jsonSchema), { id: subjectDid, ...(claims ?? {}) })
    if (violations.length > 0) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidClaims,
        422,
        'the claim set does not satisfy the json_schema',
        { violations },
      )
    }
  }

  private assertValidateState(record: VtFlowRecord, entryValidated: boolean): void {
    const accepted = [
      VtFlowState.AwaitingOr,
      VtFlowState.Validating,
      VtFlowState.OobPending,
      VtFlowState.ValidationTxFailed,
      VtFlowState.ValidatedPendingClaims,
    ]
    // Once the entry is VALIDATED on chain any validator-side state resumes into issuance, which is
    // how a backend that disabled the default notification handler drives the flow ([VSA-ADM-VT-FL-VALIDATE-11]).
    const acceptedOnceValidated = [
      VtFlowState.AwaitingValidationTx,
      VtFlowState.ValidationTxSubmitted,
      VtFlowState.Validated,
    ]
    if (accepted.includes(record.state)) return
    if (entryValidated && acceptedOnceValidated.includes(record.state)) return
    throw invalidState(`the flow is '${record.state}', which validate does not accept`)
  }

  private validationTerms(
    input: ValidateFlowInput,
    applicant: ParticipantDto,
    record: VtFlowRecord,
  ): ValidationTerms {
    for (const key of FEE_KEYS) {
      const fee = input[key]
      if (fee !== undefined && !(Number.isInteger(fee) && fee >= 0)) {
        throw invalidInput(`${key} must be a non-negative integer`)
      }
    }
    for (const key of DISCOUNT_KEYS) {
      const discount = input[key]
      if (discount !== undefined && !(discount >= 0 && discount <= 1)) {
        throw invalidInput(`${key} must be between 0 and 1`)
      }
    }
    if (input.effectiveUntil !== undefined && Number.isNaN(Date.parse(input.effectiveUntil))) {
      throw invalidInput('effectiveUntil must be an ISO 8601 datetime')
    }

    const onEntry: Record<(typeof FEE_KEYS)[number] | (typeof DISCOUNT_KEYS)[number], number> = {
      validationFees: applicant.validation_fees ?? 0,
      issuanceFees: applicant.issuance_fees ?? 0,
      verificationFees: applicant.verification_fees ?? 0,
      issuanceFeeDiscount: applicant.issuance_fee_discount ?? 0,
      verificationFeeDiscount: applicant.verification_fee_discount ?? 0,
    }
    const renewal = !!applicant.effective_from
    const recorded = record.state === VtFlowState.ValidationTxFailed ? record.validation : undefined

    const terms: ValidationTerms = {
      effectiveUntil: input.effectiveUntil ?? recorded?.effectiveUntil,
      opSummaryDigest: input.opSummaryDigest ?? recorded?.opSummaryDigest,
    }
    for (const key of [...FEE_KEYS, ...DISCOUNT_KEYS]) {
      const given = input[key]
      if (renewal) {
        if (given !== undefined && !sameTerm(key, given, onEntry[key])) {
          throw invalidInput(`${key} differs from the entry, and a renewal keeps the agreed value`)
        }
        terms[key] = onEntry[key]
      } else {
        terms[key] = given ?? recorded?.[key] ?? 0
      }
    }
    return terms
  }

  private async assertClaimsAndTerm(
    record: VtFlowRecord,
    applicant: ParticipantDto,
    terms: ValidationTerms,
  ): Promise<void> {
    if (applicant.role !== ParticipantRole.Holder) return

    if (!applicant.did) throw invalidState('the applicant entry has no DID to issue to')
    const schema = await this.agent.indexer.getCredentialSchema(applicant.schema_id)
    this.assertClaims(schema.json_schema, applicant.did, record.claims)

    // An ECS Organization or Persona credential needs a validUntil. With a validity period of 0 the
    // VPR sets no effective_until, so the call has to carry one.
    const ecsKey = await classifyEcsSchema(schema.json_schema)
    const needsValidUntil = ecsKey === ECS.ORG || ecsKey === ECS.PERSONA
    if (needsValidUntil && (schema.holder_validation_validity_period ?? 0) === 0 && !terms.effectiveUntil) {
      throw invalidInput('this schema has no validity period, so effectiveUntil is required')
    }
  }

  private async submissionPath(applicant: ParticipantDto): Promise<VtFlowSubmission> {
    const authorization = this.agent.authorizationService
    if (!authorization || applicant.validator_participant_id == null) return VtFlowSubmission.Operator

    const validator = await this.agent.indexer
      .getParticipant(applicant.validator_participant_id)
      .catch(() => undefined)
    if (!validator || !isActiveParticipant(validator)) return VtFlowSubmission.Operator

    await authorization.refreshForOperator().catch(() => undefined)
    const grant = authorization.getVsOperatorAuthorizationRecord(validator.id)
    return grant?.msgTypes.includes(veranaTypeUrls.MsgSetParticipantOPToValidated)
      ? VtFlowSubmission.Agent
      : VtFlowSubmission.Operator
  }

  private async submitValidation(
    recordId: string,
    applicant: ParticipantDto,
    validation: VtFlowValidation,
  ): Promise<VtFlowRecord> {
    const chain = this.requireChain()
    const vtFlowApi = this.resolveVtFlowApi()
    const fail = (reason: VtFlowTxReason, error: string): Promise<VtFlowRecord> =>
      vtFlowApi.recordValidation(
        recordId,
        { ...validation, tx: { status: VtFlowTxStatus.Failed, reason, error } },
        VtFlowState.ValidationTxFailed,
      )

    const message = chain.setParticipantOPToValidatedMsg({
      id: applicant.id,
      effectiveUntil: validation.effectiveUntil ? new Date(validation.effectiveUntil) : undefined,
      validationFees: validation.validationFees,
      issuanceFees: validation.issuanceFees,
      verificationFees: validation.verificationFees,
      issuanceFeeDiscount: Math.round((validation.issuanceFeeDiscount ?? 0) * DISCOUNT_SCALE),
      verificationFeeDiscount: Math.round((validation.verificationFeeDiscount ?? 0) * DISCOUNT_SCALE),
      opSummaryDigest: validation.opSummaryDigest,
    })

    const checked = await this.preflight(message, applicant.validator_participant_id)
    if ('reason' in checked) return fail(checked.reason, checked.error)

    let hash: string
    try {
      hash = await chain.broadcastWithoutWaiting([message], checked.fee)
    } catch (error) {
      return fail(VtFlowTxReason.BroadcastError, errorMessage(error))
    }

    const submitted = await vtFlowApi.recordValidation(
      recordId,
      {
        ...validation,
        tx: { hash, submittedAt: new Date().toISOString(), status: VtFlowTxStatus.Submitted },
      },
      VtFlowState.ValidationTxSubmitted,
    )
    void this.resolveValidationTx(recordId).catch(error =>
      this.agent.config.logger.error(`[vt-flow] resolving the validation of ${recordId} failed`, {
        error: errorMessage(error),
      }),
    )
    return submitted
  }

  // [VSA-ADM-VT-FL-VALIDATE-6]: the fee payer is the Corporation when the grant of the entry has with_feegrant
  private async preflight(
    message: EncodeObject,
    participantId: number | null | undefined,
  ): Promise<{ fee: StdFee } | { reason: VtFlowTxReason; error: string }> {
    const chain = this.requireChain()
    const grant =
      participantId == null
        ? undefined
        : this.agent.authorizationService?.getVsOperatorAuthorizationRecord(participantId)
    const granter = grant?.withFeegrant ? chain.corporation : undefined
    const failed = (reason: VtFlowTxReason, error: string): { reason: VtFlowTxReason; error: string } => ({
      reason,
      error,
    })

    let allowance: FeeAllowance | undefined
    try {
      allowance = granter ? await chain.feeAllowance(granter, FEE_DENOM) : undefined
    } catch (error) {
      return failed(VtFlowTxReason.PreflightError, errorMessage(error))
    }
    if (granter && !allowance) {
      return failed(
        VtFlowTxReason.FeegrantExpired,
        'the Corporation grants the agent no active fee allowance',
      )
    }

    let fee: StdFee
    try {
      fee = await chain.estimateFee([message], granter)
    } catch (error) {
      return failed(VtFlowTxReason.PreflightError, errorMessage(error))
    }
    const amount = BigInt(fee.amount.find(coin => coin.denom === FEE_DENOM)?.amount ?? '0')

    if (granter && allowance) {
      if (!allowance.unlimited && allowance.remaining < amount) {
        return failed(
          VtFlowTxReason.FeegrantExhausted,
          `the fee allowance has ${allowance.remaining}${FEE_DENOM} left`,
        )
      }
      let corporation: bigint
      try {
        corporation = BigInt((await chain.getAccountBalance(granter, FEE_DENOM)).amount)
      } catch (error) {
        return failed(VtFlowTxReason.PreflightError, errorMessage(error))
      }
      if (corporation < amount) {
        return failed(
          VtFlowTxReason.InsufficientFundsCorporation,
          `the Corporation holds ${corporation}${FEE_DENOM}`,
        )
      }
    } else {
      let own: bigint
      try {
        own = BigInt((await chain.getBalance(FEE_DENOM)).amount)
      } catch (error) {
        return failed(VtFlowTxReason.PreflightError, errorMessage(error))
      }
      if (own < amount) {
        return failed(VtFlowTxReason.InsufficientFundsAgent, `the agent account holds ${own}${FEE_DENOM}`)
      }
    }
    return { fee }
  }

  // [VSA-VTI-FLOW-ISSUE-1]: [VSA-ADM-VT-FL-VALIDATE-6] to -9 applied to the anchoring, which the delivery waits for.
  // A transaction left SUBMITTED by a restart is looked up again, not broadcast twice.
  private async anchor(
    record: VtFlowRecord,
    message: EncodeObject,
    issuerParticipantId: number,
  ): Promise<VtFlowTx> {
    const chain = this.requireChain()
    const pending = record.issuance?.tx?.status === VtFlowTxStatus.Submitted ? record.issuance.tx : undefined
    let hash = pending?.hash
    let submittedAt = pending?.submittedAt ?? new Date().toISOString()
    if (!hash) {
      const checked = await this.preflight(message, issuerParticipantId)
      if ('reason' in checked) return { status: VtFlowTxStatus.Failed, ...checked }

      try {
        hash = await chain.broadcastWithoutWaiting([message], checked.fee)
      } catch (error) {
        return {
          status: VtFlowTxStatus.Failed,
          reason: VtFlowTxReason.BroadcastError,
          error: errorMessage(error),
        }
      }
      submittedAt = new Date().toISOString()
      await this.resolveVtFlowApi().recordIssuance(record.id, {
        tx: { hash, submittedAt, status: VtFlowTxStatus.Submitted },
      })
    }
    for (;;) {
      const tx = await chain.findTx(hash).catch(() => undefined)
      if (tx?.code === 0) return { hash, submittedAt, height: tx.height, status: VtFlowTxStatus.Succeeded }
      if (tx) {
        const failure = { status: VtFlowTxStatus.Failed, reason: VtFlowTxReason.TxFailed, error: tx.rawLog }
        return { hash, submittedAt, height: tx.height, ...failure }
      }
      if (Date.now() - Date.parse(submittedAt) >= TX_LOOKUP_TIMEOUT_MS) {
        const error = 'not found 60 seconds after the broadcast'
        return { hash, submittedAt, status: VtFlowTxStatus.Failed, reason: VtFlowTxReason.TxNotFound, error }
      }
      await new Promise(resolve => setTimeout(resolve, TX_LOOKUP_INTERVAL_MS))
    }
  }

  // [VSA-ADM-VT-FL-VALIDATE-8]. Leaving VALIDATION_TX_SUBMITTED ends the loop, so the notification
  // handler moving the flow first wins the race.
  async resolveValidationTx(recordId: string): Promise<void> {
    const chain = this.requireChain()
    const vtFlowApi = this.resolveVtFlowApi()

    for (;;) {
      const record = await vtFlowApi.findById(recordId)
      const validation = record?.validation
      const hash = validation?.tx?.hash
      if (!record?.applicantParticipantId || !validation || !hash) return
      if (record.state !== VtFlowState.ValidationTxSubmitted) return

      const tx = await chain.findTx(hash).catch(() => undefined)
      if (tx && tx.code === 0) {
        const entry = await this.agent.indexer.getParticipant(record.applicantParticipantId)
        await this.markValidated(recordId, entry, { hash, height: tx.height })
        await this.continueAfterValidated(recordId)
        return
      }
      if (tx)
        return this.failUnlessValidated(record, validation, VtFlowTxReason.TxFailed, tx.rawLog, tx.height)

      const submittedAt = validation.tx?.submittedAt ?? validation.decidedAt
      if (Date.now() - Date.parse(submittedAt) >= TX_LOOKUP_TIMEOUT_MS) {
        return this.failUnlessValidated(
          record,
          validation,
          VtFlowTxReason.TxNotFound,
          'not found 60 seconds after the broadcast',
        )
      }
      await new Promise(resolve => setTimeout(resolve, TX_LOOKUP_INTERVAL_MS))
    }
  }

  // The VPR has no distinct error for a second SetParticipantOPtoValidated, so the entry tells a
  // rejected duplicate apart from a real failure.
  private async failUnlessValidated(
    record: VtFlowRecord,
    validation: VtFlowValidation,
    reason: VtFlowTxReason,
    error: string,
    height?: number,
  ): Promise<void> {
    const vtFlowApi = this.resolveVtFlowApi()
    const applicant = record.applicantParticipantId
      ? await this.agent.indexer.getParticipant(record.applicantParticipantId)
      : undefined
    const failed: VtFlowValidation = {
      ...validation,
      tx: { ...validation.tx, height, status: VtFlowTxStatus.Failed, reason, error },
    }
    if (applicant?.op_state === 'VALIDATED') {
      if (reason === VtFlowTxReason.TxFailed) await vtFlowApi.recordValidation(record.id, failed)
      await this.markValidated(record.id, applicant)
      await this.continueAfterValidated(record.id)
      return
    }
    await vtFlowApi.recordValidation(record.id, failed, VtFlowState.ValidationTxFailed)
  }

  /**
   * [VSA-VTI-FLOW-OP-ISSUE]: moves the flow to VALIDATED and fills `validation` from the validated
   * entry. Without the landed transaction, a recorded broadcast keeps its submission and tx.
   */
  async markValidated(
    recordId: string,
    entry: ParticipantDto,
    landed?: { hash: string; height: number; timestamp?: string },
  ): Promise<VtFlowRecord> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(recordId)
    if (!record) throw new Error(`vt-flow record ${recordId} not found`)
    if (!VtFlowValidatedFromStates.has(record.state) && record.state !== VtFlowState.TerminatedByValidator) {
      throw invalidState(`the flow is '${record.state}', which does not precede VALIDATED`)
    }
    const recorded = record.validation
    const agentTx = landed && recorded?.tx?.hash === landed.hash ? recorded.tx : undefined
    const validation: VtFlowValidation = {
      ...recorded,
      decidedAt: recorded?.decidedAt ?? landed?.timestamp ?? entry.modified,
      submission:
        !landed && recorded?.tx?.hash && recorded.tx.reason !== VtFlowTxReason.TxFailed
          ? recorded.submission
          : agentTx
            ? VtFlowSubmission.Agent
            : VtFlowSubmission.Operator,
      validationFees: entry.validation_fees,
      issuanceFees: entry.issuance_fees,
      verificationFees: entry.verification_fees,
      issuanceFeeDiscount: entry.issuance_fee_discount,
      verificationFeeDiscount: entry.verification_fee_discount,
      effectiveUntil: entry.effective_until ?? undefined,
      ...(agentTx && {
        tx: {
          hash: agentTx.hash,
          submittedAt: agentTx.submittedAt,
          height: landed?.height,
          status: VtFlowTxStatus.Succeeded,
        },
      }),
    }
    return vtFlowApi.recordValidation(recordId, validation, VtFlowState.Validated)
  }

  /** rejectFlow ended the flow with its transaction in flight, and no newer flow of the applicant replaced it ([VSA-ADM-VT-FL-REJECT-2]). */
  async isRejectedInFlight(record: VtFlowRecord): Promise<boolean> {
    if (record.state !== VtFlowState.TerminatedByValidator || !record.validation) return false
    if (!record.applicantParticipantId) return false
    const [latest] = (
      await this.resolveVtFlowApi().findAllByQuery({
        role: VtFlowRole.Validator,
        applicantParticipantId: record.applicantParticipantId,
      })
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return latest?.id === record.id
  }

  async continueAfterValidated(recordId: string): Promise<VtFlowRecord> {
    const vtFlowApi = this.resolveVtFlowApi()
    const record = await vtFlowApi.findById(recordId)
    if (!record) throw new Error(`vt-flow record ${recordId} not found`)
    if (record.state !== VtFlowState.Validated && record.state !== VtFlowState.ValidatedPendingClaims) {
      return record
    }

    const participant = await this.agent.indexer.findParticipant(Number(record.applicantParticipantId))
    if (!participant) throw new Error(`Applicant participant ${record.applicantParticipantId} not found`)
    if (Number(participant.role) !== HOLDER_PARTICIPANT_TYPE) return record

    const schema = await this.agent.indexer.getCredentialSchema(participant.schemaId)
    const violations = schemaViolations(JSON.parse(schema.json_schema), {
      id: participant.did,
      ...(record.claims ?? {}),
    })
    if (violations.length > 0) {
      this.agent.config.logger.error(
        `[vt-flow] not offering the credential of flow ${recordId}: its claims do not satisfy the ` +
          `json_schema of schema ${participant.schemaId}: ${violations.map(v => `${v.path} ${v.message}`.trim()).join(', ')}`,
      )
      return record.state === VtFlowState.Validated ? vtFlowApi.markPendingClaims(recordId) : record
    }
    return this.offerOnboardingCredential({ vtFlowRecordId: recordId, participant })
  }

  /** [VSA-ADM-VT-FL-VALIDATE-8]: at startup, resume every flow left in VALIDATION_TX_SUBMITTED. */
  async resumeValidationSubmissions(): Promise<void> {
    const pending = await this.resolveVtFlowApi().findAllByQuery({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.ValidationTxSubmitted,
    })
    await Promise.all(pending.map(record => this.resolveValidationTx(record.id)))
  }

  /** [VSA-VTI-FLOW-ISSUE-1]: at startup, resume every anchoring left SUBMITTED through the stored issued credential. */
  async resumeIssuanceSubmissions(): Promise<void> {
    const vtFlowApi = this.resolveVtFlowApi()
    const offered = await vtFlowApi.findAllByQuery({
      role: VtFlowRole.Validator,
      flowState: VtFlowState.CredOffered,
    })
    await Promise.all(
      offered.map(({ id, issuance, credentialExchangeRecordId }) =>
        issuance?.tx?.status === VtFlowTxStatus.Submitted && credentialExchangeRecordId
          ? vtFlowApi.issueCredentialForSession({ vtFlowRecordId: id, credentialExchangeRecordId })
          : undefined,
      ),
    )
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

  /** Fired after signing and before delivery. A failed anchoring comes back in `issuance`, and the credential stays undelivered. */
  async onCredentialIssued(
    vtFlowRecordId: string,
    signedCredential: Record<string, unknown>,
  ): Promise<{ credentialDigest: string; issuance: VtFlowIssuance }> {
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
    const message = chain.createOrUpdateParticipantSessionMsg({
      id: record.participantSessionId,
      issuerParticipantId: record.issuerParticipantId,
      agentParticipantId: Number(record.agentParticipantId ?? 0) || 0,
      walletAgentParticipantId: Number(record.walletAgentParticipantId ?? 0) || 0,
      digest,
    })
    return {
      credentialDigest: digest,
      issuance: { tx: await this.anchor(record, message, record.issuerParticipantId) },
    }
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
    if (record.applicantParticipantId == null) return
    await chain.triggerResolver(Number(record.applicantParticipantId))
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
