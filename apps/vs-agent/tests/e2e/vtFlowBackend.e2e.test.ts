import { ConsoleLogger, DidDocument, DidDocumentService, type DidResolver, LogLevel } from '@credo-ts/core'
import { DidCommAutoAcceptCredential, DidCommCredentialState } from '@credo-ts/didcomm'
import {
  VtFlowErrorCode,
  VtFlowEventTypes,
  VtFlowPendingAction,
  VtFlowRole,
  VtFlowState,
  type VtFlowStateChangedEvent,
  VtFlowSubmission,
  VtFlowTxStatus,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { computeSchemaDigest } from '@verana-labs/vs-agent-model'
import {
  AdminApiErrorCode,
  AuthorizationService,
  createJsc,
  getEcsSchemas,
  HOLDER_PARTICIPANT_TYPE,
  IndexerWebSocketService,
  ISSUER_GRANTOR_PARTICIPANT_TYPE,
  ISSUER_PARTICIPANT_TYPE,
  ParticipantState,
  VERIFIER_GRANTOR_PARTICIPANT_TYPE,
  VERIFIER_PARTICIPANT_TYPE,
  VeranaChainService,
  VeranaIndexerService,
  VsAgentEventTypes,
  VtFlowOrchestrator,
  type VsAgent,
  type VsAgentIndexerNotificationEvent,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { VeranaTestChain } from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import {
  COOLUSER_MNEMONIC,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from '../../../../packages/agent-sdk/tests/e2e/helpers'
import { mockResponses, startAgent } from '../__mocks__'
import { FakeDidResolver } from '../__mocks__/fakeDidResolver'
import type { V2VtFlowRecordDto } from '../../src/controllers/admin/v2/vt/dto'
import { VtFlowsService } from '../../src/controllers/admin/v2/vt/VtFlowsService'
import { SubjectInboundTransport, SubjectOutboundTransport, type SubjectMessage } from '../helpers'

const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'
const PP_TRIGGER_RESOLVER = '/verana.pp.v1.MsgTriggerResolver'
const GRANTOR_ONBOARDING_PROCESS = 3
const ECOSYSTEM_DID = 'did:example:ecosystem'

const jsonSchema = (title: string): string =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description: `vt-flow ${title}`,
    type: 'object',
    properties: {
      credentialSubject: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' }, memberId: { type: 'string' } },
        required: ['name', 'memberId'],
      },
    },
    required: ['credentialSubject'],
  })

const fullClaims = { name: 'Applicant Org', memberId: 'M-001' }

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function until<T>(
  read: () => Promise<T | undefined>,
  what: () => string,
  timeoutMs = 240_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what()}`)
    await delay(2_000)
  }
}

describe('v4 vt-flow driven by an onboarding backend on a live chain and indexer', () => {
  const logger = new ConsoleLogger(LogLevel.Warn)
  const resolver = new FakeDidResolver()
  const ecosystemServices: DidDocumentService[] = []
  const ecosystemResolver: DidResolver = {
    supportedMethods: ['example'],
    allowsCaching: false,
    allowsLocalDidRecord: false,
    resolve: async (_, did) => ({
      didDocument: did === ECOSYSTEM_DID ? new DidDocument({ id: did, service: ecosystemServices }) : null,
      didDocumentMetadata: {},
      didResolutionMetadata: did === ECOSYSTEM_DID ? {} : { error: 'notFound' },
    }),
  }
  const subjects: Record<string, Subject<SubjectMessage>> = {
    'rxjs:validator': new Subject<SubjectMessage>(),
    'rxjs:applicant': new Subject<SubjectMessage>(),
  }
  const subscriptions: IndexerWebSocketService[] = []
  const history = new Map<string, VtFlowState[]>()
  const handledTxs = new Set<string>()
  const verifiedExchanges: string[] = []

  let stack: StartedStack
  let chain: VeranaTestChain
  let operatorChain: VeranaChainService
  let indexer: VeranaIndexerService
  let validator: VsAgent
  let applicant: VsAgent
  let validatorFlows: VtFlowsService
  let applicantFlows: VtFlowsService
  let corporation: string
  let holderValidatorId: number
  let issuerGrantorId: number
  let verifierGrantorId: number
  let holderId: number
  let holderSid: string
  let issuerId: number
  let issuerSid: string

  const statesOf = (vtFlowRecordId: string): VtFlowState[] => history.get(vtFlowRecordId) ?? []

  const startChain = async (mnemonic: string): Promise<VeranaChainService> => {
    const service = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic,
      corporationAddress: corporation,
      logger,
    })
    await service.start()
    return service
  }

  // the onboarding hooks of apps/vs-agent/src/utils/setupAgent.ts
  const startFlowAgent = async (
    domain: string,
    veranaChain: VeranaChainService,
    resolvers: DidResolver[],
  ): Promise<VsAgent> => {
    let orchestrator: VtFlowOrchestrator
    const agent = await startAgent({
      label: domain,
      domain,
      veranaChain,
      indexer,
      vtFlowOptions: {
        autoAcceptOnboardingRequest: true,
        autoIssueCredentialOnRequest: true,
        autoOfferCredential: true,
        autoAcceptCredentialOffer: true,
        assertVerifiableService: async ({ peerDid }) => !peerDid.startsWith('did:peer:'),
        buildCredentialOffer: async ({ record }) => orchestrator.buildDirectIssuanceOffer(record.id),
        onBeforeCredentialIssued: async ({ record, credential }) =>
          orchestrator.onCredentialIssued(record.id, credential as never),
        verifyCredential: async ({ record, credentialExchangeRecord }) => {
          for (let attempt = 1; attempt <= 10; attempt++) {
            try {
              await orchestrator.verifyOfferedCredential(record.id)
              verifiedExchanges.push(credentialExchangeRecord.id)
              return true
            } catch (error) {
              if (attempt === 10) logger.error(`verifyCredential failed: ${(error as Error).message}`)
              else await delay(3_000)
            }
          }
          return false
        },
        onCompleted: async ({ record }) =>
          orchestrator
            .onCredentialCompleted(record.id)
            .catch((error: Error) => logger.warn(`onCompleted: ${error.message}`)),
      },
    })
    orchestrator = new VtFlowOrchestrator(agent, { publicApiBaseUrl: agent.publicApiBaseUrl })
    agent.didcomm.registerInboundTransport(new SubjectInboundTransport(subjects[`rxjs:${domain}`]))
    agent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjects))
    agent.dids.config.resolvers.unshift(...resolvers)
    await agent.initialize()
    await resolver.registerAgent(agent)
    agent.events.on<VtFlowStateChangedEvent>(VtFlowEventTypes.VtFlowStateChanged, ({ payload }) => {
      history.set(payload.vtFlowRecordId, [...statesOf(payload.vtFlowRecordId), payload.state])
    })
    agent.events.on<VsAgentIndexerNotificationEvent>(VsAgentEventTypes.IndexerNotification, ({ payload }) => {
      handledTxs.add(`${agent.did} ${payload.event.txHash.toLowerCase()}`)
    })
    return agent
  }

  const untilHandled = (agent: VsAgent, txHash: string): Promise<true> =>
    until(
      async () => handledTxs.has(`${agent.did} ${txHash.toLowerCase()}`) || undefined,
      () => `${agent.did} to handle ${txHash}`,
    )

  const untilState = (flows: VtFlowsService, sid: string, state: VtFlowState): Promise<V2VtFlowRecordDto> => {
    let last: V2VtFlowRecordDto | undefined
    return until(
      async () => {
        last = await flows.getFlow(sid)
        return last.flowState === state ? last : undefined
      },
      () => `flow ${sid} in ${state}, last ${JSON.stringify(last)}`,
    )
  }

  const untilValidatingFlowOf = (applicantParticipantId: number): Promise<V2VtFlowRecordDto> =>
    until(
      async () => {
        const { items } = await validatorFlows.listFlowsPage({
          applicantParticipantId: String(applicantParticipantId),
        })
        const [flow] = items
        return items.length === 1 && flow.flowState === VtFlowState.Validating && flow.validatorParticipantId
          ? flow
          : undefined
      },
      () => `the VALIDATING flow of participant ${applicantParticipantId}`,
    )

  beforeAll(async () => {
    stack = await startStack()
    const indexerUrl = stack.indexerWsUrl.replace(/^ws/, 'http')
    indexer = new VeranaIndexerService({ baseUrl: indexerUrl, logger })
    chain = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)

    corporation = (await chain.createCorporation({ did: 'did:example:corporation' })).policyAddress
    await chain.fundCorporation(corporation)
    await chain.grantOperatorAuthorization(corporation)
    const { ecosystemId } = await chain.createEcosystem(corporation, { did: ECOSYSTEM_DID })
    const holderJsonSchema = jsonSchema('MembershipCredential')
    const { schemaId: holderSchemaId } = await chain.createCredentialSchema(corporation, {
      ecosystemId,
      jsonSchema: holderJsonSchema,
    })
    const { schemaId: grantorSchemaId } = await chain.createCredentialSchema(corporation, {
      ecosystemId,
      jsonSchema: jsonSchema('AccreditationCredential'),
      issuerOnboardingMode: GRANTOR_ONBOARDING_PROCESS,
      verifierOnboardingMode: GRANTOR_ONBOARDING_PROCESS,
    })
    const holderRoot = await chain.createRootParticipant(corporation, {
      schemaId: holderSchemaId,
      did: 'did:example:holder-root',
    })
    const grantorRoot = await chain.createRootParticipant(corporation, {
      schemaId: grantorSchemaId,
      did: 'did:example:grantor-root',
    })

    const validatorOperator = await chain.createFundedOperator()
    const applicantOperator = await chain.createFundedOperator()
    await chain.grantOperatorAuthorization(corporation, applicantOperator.address, [PP_TRIGGER_RESOLVER])
    operatorChain = await startChain(COOLUSER_MNEMONIC)
    const validatorChain = await startChain(validatorOperator.mnemonic)

    validator = await startFlowAgent('validator', validatorChain, [resolver, ecosystemResolver])
    validator.authorizationService = new AuthorizationService({ chain: validatorChain, indexer, logger })
    // its own account keeps the TriggerResolver of the applicant off the sequence of the test signer
    applicant = await startFlowAgent('applicant', await startChain(applicantOperator.mnemonic), [
      resolver,
      ecosystemResolver,
    ])
    validatorFlows = new VtFlowsService({ getAgent: async () => validator } as never)
    applicantFlows = new VtFlowsService({ getAgent: async () => applicant } as never)

    holderValidatorId = (
      await chain.startParticipantOp(corporation, {
        role: ISSUER_PARTICIPANT_TYPE,
        validatorParticipantId: holderRoot.participantId,
        did: validator.did!,
        vsOperator: validatorOperator.address,
        vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
      })
    ).participantId
    await operatorChain.setParticipantOPToValidated({
      id: holderValidatorId,
      opSummaryDigest: 'sha384-issuer',
    })
    const grantor = async (role: number): Promise<number> => {
      const { participantId } = await chain.startParticipantOp(corporation, {
        role,
        validatorParticipantId: grantorRoot.participantId,
        did: validator.did!,
      })
      await operatorChain.setParticipantOPToValidated({
        id: participantId,
        opSummaryDigest: 'sha384-grantor',
      })
      return participantId
    }
    issuerGrantorId = await grantor(ISSUER_GRANTOR_PARTICIPANT_TYPE)
    verifierGrantorId = await grantor(VERIFIER_GRANTOR_PARTICIPANT_TYPE)

    const vtjsc = await createJsc(
      validator,
      validator.publicApiBaseUrl,
      getEcsSchemas(validator.publicApiBaseUrl),
      {
        schemaBaseId: String(holderSchemaId),
        jsonSchemaRef: `vpr:verana:${validatorChain.getChainId}:cs:${holderSchemaId}`,
        precomputedDigestSRI: await computeSchemaDigest(JSON.parse(holderJsonSchema)),
      },
    )
    const vtjscEndpoint = `https://ecosystem/vt/schemas-${holderSchemaId}-c-vp.json`
    mockResponses[vtjscEndpoint] = { verifiableCredential: [vtjsc] }
    ecosystemServices.push(
      new DidDocumentService({
        id: `${ECOSYSTEM_DID}#vpr-schemas-${holderSchemaId}-vtjsc-vp`,
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: vtjscEndpoint,
      }),
    )

    await until(
      async () => {
        const active = await indexer.listParticipants({
          did: validator.did!,
          participantState: ParticipantState.Active,
        })
        const grants = await indexer.listVsOperatorAuthorizations(validatorOperator.address)
        const grant = grants.flatMap(g => g.records).find(r => r.participantId === holderValidatorId)
        return active.length === 3 && grant?.msgTypes.includes(PP_VALIDATE) ? true : undefined
      },
      () => 'the validator entries to be active and granted',
    )

    for (const agent of [validator, applicant]) {
      // startParticipantOPAutoFlow waits until the agent's own DID document is fetchable
      mockResponses[`${agent.publicApiBaseUrl}/.well-known/did.jsonl`] = {}
      const subscription = new IndexerWebSocketService({ indexerUrl, agent })
      subscriptions.push(subscription)
      await subscription.start()
    }
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    for (const subscription of subscriptions) subscription.stop()
    await applicant?.shutdown().catch(() => undefined)
    await validator?.shutdown().catch(() => undefined)
    chain?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'onboards a HOLDER from StartParticipantOP to an anchored and verified credential',
    async () => {
      holderId = (
        await chain.startParticipantOp(corporation, {
          role: HOLDER_PARTICIPANT_TYPE,
          validatorParticipantId: holderValidatorId,
          did: applicant.did!,
        })
      ).participantId

      const found = await untilValidatingFlowOf(holderId)
      holderSid = found.participantSessionId
      expect(found).toMatchObject({
        role: VtFlowRole.Validator,
        applicantParticipantId: String(holderId),
        validatorParticipantId: String(holderValidatorId),
        connectionState: 'ESTABLISHED',
        pendingAction: VtFlowPendingAction.Validator,
      })
      expect(found.claims).toBeUndefined()
      const requested = await untilState(applicantFlows, holderSid, VtFlowState.Validating)
      expect(requested.pendingAction).toBe(VtFlowPendingAction.Validator)
      expect(requested.claims).toBeUndefined()

      const oobLink = {
        url: `https://portal.example/sessions/${holderSid}`,
        description: 'Upload your membership proof',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }
      const linked = await validatorFlows.sendOobLink(
        holderSid,
        oobLink.url,
        oobLink.description,
        oobLink.expiresAt,
      )
      expect(linked).toMatchObject({
        state: VtFlowState.OobPending,
        oobLink,
        pendingAction: VtFlowPendingAction.Applicant,
      })
      const oobMessage = { type: 'oob-link', text: oobLink.description, url: oobLink.url }
      expect(linked.messages.at(-1)).toMatchObject(oobMessage)
      const received = await untilState(applicantFlows, holderSid, VtFlowState.OobPending)
      expect(received).toMatchObject({ oobLink, pendingAction: VtFlowPendingAction.Applicant })
      expect(received.messages.at(-1)).toMatchObject(oobMessage)

      const edited = await validatorFlows.editCredentialClaims(holderSid, fullClaims)
      expect(edited).toMatchObject({ state: VtFlowState.OobPending, claims: fullClaims })

      const started = await validatorFlows.startValidation(holderSid)
      expect(started.state).toBe(VtFlowState.Validating)
      expect(started.oobLink).toBeUndefined()
      expect(started.messages.at(-1)).toMatchObject({ type: 'validating', text: undefined })
      const resumed = await untilState(applicantFlows, holderSid, VtFlowState.Validating)
      expect(resumed.oobLink).toBeUndefined()
      expect(resumed.messages.at(-1)).toMatchObject({ type: 'validating', text: undefined })

      const submitted = await validatorFlows.validateFlow(holderSid, {})
      expect(submitted).toMatchObject({
        state: VtFlowState.ValidationTxSubmitted,
        pendingAction: VtFlowPendingAction.Chain,
        validation: { submission: VtFlowSubmission.Agent, tx: { status: VtFlowTxStatus.Submitted } },
      })

      const issued = await untilState(validatorFlows, holderSid, VtFlowState.Completed)
      const held = await untilState(applicantFlows, holderSid, VtFlowState.Completed)
      const validationTx = await operatorChain.findTx(submitted.validation!.tx!.hash!)
      const anchoringTx = await operatorChain.findTx(issued.issuance!.tx!.hash!)
      expect(issued).toMatchObject({
        pendingAction: VtFlowPendingAction.None,
        connectionState: 'ESTABLISHED',
        issuance: { tx: { status: VtFlowTxStatus.Succeeded, height: anchoringTx?.height } },
      })
      expect(held).toMatchObject({ pendingAction: VtFlowPendingAction.None, connectionState: 'ESTABLISHED' })
      expect(await indexer.getDigest(issued.credentialDigest!)).toBeDefined()
      const exchange = await applicant.didcomm.credentials.getById(held.credentialExchangeRecordId!)
      expect(exchange).toMatchObject({
        state: DidCommCredentialState.Done,
        autoAcceptCredential: DidCommAutoAcceptCredential.Never,
      })
      expect(verifiedExchanges).toContain(exchange.id)

      const entry = await indexer.getParticipant(holderId)
      expect(entry.op_state).toBe('VALIDATED')
      const { credential } = await applicant.didcomm.credentials.getFormatData(exchange.id)
      const signed = (credential as { dataIntegrity?: { credential?: object } } | undefined)?.dataIntegrity
        ?.credential
      expect(signed).toMatchObject({ id: issued.credentialId, validUntil: entry.effective_until })
      expect(issued.credentialId?.startsWith(`${validator.did}#`)).toBe(true)
      expect(issued.validation).toMatchObject({
        submission: VtFlowSubmission.Agent,
        validationFees: entry.validation_fees,
        issuanceFees: entry.issuance_fees,
        verificationFees: entry.verification_fees,
        issuanceFeeDiscount: entry.issuance_fee_discount,
        verificationFeeDiscount: entry.verification_fee_discount,
        effectiveUntil: entry.effective_until,
        tx: {
          hash: submitted.validation?.tx?.hash,
          status: VtFlowTxStatus.Succeeded,
          height: validationTx?.height,
        },
      })
      expect(statesOf(issued.id).slice(-3)).toEqual([
        VtFlowState.Validated,
        VtFlowState.CredOffered,
        VtFlowState.Completed,
      ])
      expect(statesOf(held.id).slice(-3)).toEqual([
        VtFlowState.Validated,
        VtFlowState.CredOffered,
        VtFlowState.Completed,
      ])
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'renews the COMPLETED HOLDER flow in place, holds it in VALIDATED_PENDING_CLAIMS, then issues a new credential',
    async () => {
      const before = await validatorFlows.getFlow(holderSid)
      const beforeHeld = await applicantFlows.getFlow(holderSid)
      await operatorChain.renewParticipantOP(holderId)

      const renewed = await untilState(validatorFlows, holderSid, VtFlowState.Validating)
      const renewedHeld = await untilState(applicantFlows, holderSid, VtFlowState.Validating)
      expect(renewed.id).toBe(before.id)
      expect(renewedHeld.id).toBe(beforeHeld.id)
      expect(renewed.validation).toBeUndefined()
      expect(renewed.issuance).toBeUndefined()
      expect(statesOf(renewed.id).slice(-3)).toEqual([
        VtFlowState.Completed,
        VtFlowState.AwaitingOr,
        VtFlowState.Validating,
      ])
      expect(statesOf(renewedHeld.id).slice(-3)).toEqual([
        VtFlowState.Completed,
        VtFlowState.OrSent,
        VtFlowState.Validating,
      ])

      const partial = await validatorFlows.editCredentialClaims(holderSid, { name: fullClaims.name })
      expect(partial.claims).toEqual({ name: fullClaims.name })
      await operatorChain.setParticipantOPToValidated({ id: holderId })

      const pending = await untilState(validatorFlows, holderSid, VtFlowState.ValidatedPendingClaims)
      expect(pending).toMatchObject({
        pendingAction: VtFlowPendingAction.Validator,
        validation: { submission: VtFlowSubmission.Operator },
      })
      expect(pending.credentialExchangeRecordId).toBe(before.credentialExchangeRecordId)
      const waiting = await untilState(applicantFlows, holderSid, VtFlowState.Validated)
      expect(waiting.pendingAction).toBe(VtFlowPendingAction.Agent)

      await validatorFlows.editCredentialClaims(holderSid, fullClaims)
      expect((await validatorFlows.validateFlow(holderSid, {})).state).toBe(VtFlowState.CredOffered)

      const reissued = await untilState(validatorFlows, holderSid, VtFlowState.Completed)
      const reheld = await untilState(applicantFlows, holderSid, VtFlowState.Completed)
      expect(reissued.issuance?.tx?.status).toBe(VtFlowTxStatus.Succeeded)
      expect(reissued.credentialExchangeRecordId).not.toBe(before.credentialExchangeRecordId)
      expect(reissued.credentialDigest).not.toBe(before.credentialDigest)
      expect(await indexer.getDigest(reissued.credentialDigest!)).toBeDefined()
      expect(reheld.credentialExchangeRecordId).not.toBe(beforeHeld.credentialExchangeRecordId)
      expect(verifiedExchanges).toContain(reheld.credentialExchangeRecordId)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'validates a non-HOLDER to a terminal VALIDATED with no credential, and renews it in place',
    async () => {
      issuerId = (
        await chain.startParticipantOp(corporation, {
          role: ISSUER_PARTICIPANT_TYPE,
          validatorParticipantId: issuerGrantorId,
          did: applicant.did!,
        })
      ).participantId
      issuerSid = (await untilValidatingFlowOf(issuerId)).participantSessionId
      await untilState(applicantFlows, issuerSid, VtFlowState.Validating)

      const refused = await validatorFlows.editCredentialClaims(issuerSid, fullClaims).catch(error => error)
      expect(refused.code).toBe(AdminApiErrorCode.NoCredentialForRole)

      const decidedFrom = Date.now()
      const decided = await validatorFlows.validateFlow(issuerSid, {})
      expect(decided).toMatchObject({
        state: VtFlowState.AwaitingValidationTx,
        pendingAction: VtFlowPendingAction.Validator,
        validation: { submission: VtFlowSubmission.Operator },
      })
      expect(Date.parse(decided.validation!.decidedAt)).toBeGreaterThanOrEqual(decidedFrom)
      expect(decided.validation?.tx).toBeUndefined()
      expect(await applicantFlows.getFlow(issuerSid)).toMatchObject({
        flowState: VtFlowState.Validating,
        pendingAction: VtFlowPendingAction.Validator,
      })

      const { txHash } = await operatorChain.setParticipantOPToValidated({
        id: issuerId,
        opSummaryDigest: 'sha384-issuer',
      })
      await untilHandled(validator, txHash)
      await untilHandled(applicant, txHash)
      const validated = await validatorFlows.getFlow(issuerSid)
      const accredited = await applicantFlows.getFlow(issuerSid)
      expect(validated).toMatchObject({
        flowState: VtFlowState.Validated,
        pendingAction: VtFlowPendingAction.None,
        validation: { submission: VtFlowSubmission.Operator },
      })
      expect(accredited).toMatchObject({
        flowState: VtFlowState.Validated,
        pendingAction: VtFlowPendingAction.None,
      })
      expect(validated.credentialExchangeRecordId).toBeUndefined()
      expect(accredited.credentialExchangeRecordId).toBeUndefined()

      await operatorChain.renewParticipantOP(issuerId)
      const renewed = await untilState(validatorFlows, issuerSid, VtFlowState.Validating)
      const renewedAccredited = await untilState(applicantFlows, issuerSid, VtFlowState.Validating)
      expect(renewed.id).toBe(validated.id)
      expect(renewedAccredited.id).toBe(accredited.id)
      expect(renewed.validation).toBeUndefined()
      expect(statesOf(renewed.id).slice(-3)).toEqual([
        VtFlowState.Validated,
        VtFlowState.AwaitingOr,
        VtFlowState.Validating,
      ])
      expect(statesOf(renewedAccredited.id).slice(-3)).toEqual([
        VtFlowState.Validated,
        VtFlowState.OrSent,
        VtFlowState.Validating,
      ])
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'rejects a VALIDATING flow with a problem-report and no transaction',
    async () => {
      const description = 'The registry lookup failed'
      const rejected = await validatorFlows.rejectFlow(issuerSid, { description })
      expect(rejected).toMatchObject({
        state: VtFlowState.TerminatedByValidator,
        connectionState: 'TERMINATED',
        pendingAction: VtFlowPendingAction.None,
      })
      expect(rejected.messages.at(-1)).toMatchObject({ type: 'problem-report', text: description })

      const terminated = await untilState(applicantFlows, issuerSid, VtFlowState.TerminatedByValidator)
      expect(terminated).toMatchObject({
        connectionState: 'TERMINATED',
        pendingAction: VtFlowPendingAction.None,
      })
      expect(terminated.messages.at(-1)).toMatchObject({ type: 'problem-report', text: description })
      expect((await indexer.getParticipant(issuerId)).op_state).toBe('PENDING')
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'keeps the applicant terminated when the operator validation lands after a reject',
    async () => {
      const { participantId: verifierId } = await chain.startParticipantOp(corporation, {
        role: VERIFIER_PARTICIPANT_TYPE,
        validatorParticipantId: verifierGrantorId,
        did: applicant.did!,
      })
      const sid = (await untilValidatingFlowOf(verifierId)).participantSessionId
      await untilState(applicantFlows, sid, VtFlowState.Validating)

      expect((await validatorFlows.validateFlow(sid, {})).state).toBe(VtFlowState.AwaitingValidationTx)
      const rejected = await validatorFlows.rejectFlow(sid, {
        code: VtFlowErrorCode.SessionTerminated,
        description: 'Policy change',
      })
      expect(rejected.state).toBe(VtFlowState.TerminatedByValidator)
      await untilState(applicantFlows, sid, VtFlowState.TerminatedByValidator)

      const { txHash } = await operatorChain.setParticipantOPToValidated({
        id: verifierId,
        opSummaryDigest: 'sha384-verifier',
      })
      const landed = await untilState(validatorFlows, sid, VtFlowState.Validated)
      expect(landed).toMatchObject({
        connectionState: 'TERMINATED',
        pendingAction: VtFlowPendingAction.None,
        validation: { submission: VtFlowSubmission.Operator },
      })
      expect(landed.credentialExchangeRecordId).toBeUndefined()
      await untilHandled(applicant, txHash)
      expect((await applicantFlows.getFlow(sid)).flowState).toBe(VtFlowState.TerminatedByValidator)

      const refused = await validatorFlows.validateFlow(sid, {}).catch(error => error)
      expect(refused.code).toBe(AdminApiErrorCode.InvalidState)
    },
    SETUP_TIMEOUT_MS,
  )
})
