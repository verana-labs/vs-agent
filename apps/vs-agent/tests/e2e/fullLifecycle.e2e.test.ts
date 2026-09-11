import type { VsAgent } from '@verana-labs/vs-agent-sdk'

// The holder builds its credential request with the native AnonCreds binding, which registers
// itself into the shared module on import.
import '@hyperledger/anoncreds-nodejs'

import { AnonCredsCredentialDefinitionRepository, AnonCredsSchemaRepository } from '@credo-ts/anoncreds'
import { DidCommCredentialState, DidCommProofState } from '@credo-ts/didcomm'
import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import { ConsoleLogger, DidRepository, LogLevel } from '@credo-ts/core'
import { VtFlowApi, VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { computeSchemaDigest } from '@verana-labs/vs-agent-model'
import type { EcsClaims } from '@verana-labs/vs-agent-sdk'

import {
  createJsc,
  EcsBootstrapService,
  findAttestedResources,
  getEcsSchemas,
  ParticipantRole,
  ParticipantState,
  rebindEcsCredentialSchema,
  reconcileVtFlowRecordsOnCancel,
  reconcileVtjscPublications,
  removeSelfIssuedEcsCredentialsIfIssuerRevoked,
  resolveJsonSchemaCredentialId,
  VeranaChainService,
  VeranaIndexerService,
  VtFlowOrchestrator,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  PARTICIPANT_ROLE_ISSUER,
  PARTICIPANT_ROLE_VERIFIER,
  VeranaTestChain,
} from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import {
  COOLUSER_MNEMONIC,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from '../../../../packages/agent-sdk/tests/e2e/helpers'
import { mockResponses, startAgent } from '../__mocks__'
import { FakeDidResolver } from '../__mocks__/fakeDidResolver'
import { AdminApiError } from '../../src/common'
import { CredentialTypesService } from '../../src/controllers/admin/credentials'
import { V2DidcommCredentialExchangesController } from '../../src/controllers/admin/v2/didcomm/V2DidcommCredentialExchangesController'
import { V2DidcommPresentationsController } from '../../src/controllers/admin/v2/didcomm/V2DidcommPresentationsController'
import {
  invitationUrl,
  isVtFlowStateChangedEvent,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  waitForEvent,
  type SubjectMessage,
} from '../helpers'

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'
const PP_START_OP = '/verana.pp.v1.MsgStartParticipantOP'

const ecsSchema = (title: string) =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description: `lifecycle ${title}`,
    type: 'object',
    properties: {
      credentialSubject: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['name'],
      },
    },
    required: ['credentialSubject'],
  })

// every digest is supplied, so building the credential never fetches the referenced resources
vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes of ${url}`) })) },
}))

const ecsClaims: EcsClaims = {
  service: {
    name: 'Test Service',
    type: 'WEB_PORTAL',
    description: 'a test service',
    logoUri: 'https://example.com/logo.svg',
    minimumAgeRequired: '18',
    termsAndConditionsUri: 'https://example.com/terms.html',
    privacyPolicyUri: 'https://example.com/privacy.html',
  },
  org: {
    name: 'Test Org',
    logoUri: 'https://example.com/logo.svg',
    registryId: 'ID-123',
    registryUri: 'https://example.com/registry',
    address: 'Some address',
    countryCode: 'EE',
    organizationKind: 'PUBLIC',
  },
}

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn().catch(() => undefined)
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 2_000))
  }
  throw new Error('condition did not resolve in time')
}

describe('v4 full lifecycle on a live chain and indexer', () => {
  let stack: StartedStack
  let chainA: VeranaTestChain
  let seederChain: VeranaChainService
  let validatorChain: VeranaChainService
  let indexer: VeranaIndexerService
  let validator: VsAgent
  let applicant: VsAgent
  let validatorEvents: ReturnType<typeof vi.spyOn>
  let applicantEvents: ReturnType<typeof vi.spyOn>
  let applicantOrchestrator: VtFlowOrchestrator
  let ecosystemDid: string
  let ecosystemId: number
  let orgSchemaId: number
  let serviceSchemaId: number
  let validatorParticipantId: number
  let serviceOpId: number
  let serviceRootId: number
  let applicantIssuerParticipantId: number
  let corpPolicyAddress: string
  let childMessages: Subject<SubjectMessage>
  let subjectMap: Record<string, Subject<SubjectMessage>>
  const resolver = new FakeDidResolver()
  const logger = new ConsoleLogger(LogLevel.Warn)

  beforeAll(async () => {
    stack = await startStack()
    chainA = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
    indexer = new VeranaIndexerService({
      baseUrl: stack.indexerWsUrl.replace(/^ws/, 'http'),
      logger,
    })

    ecosystemDid = `did:example:eco-${RUN_ID}`
    const corp = await chainA.createCorporation({ did: `did:example:corp-${RUN_ID}` })
    await chainA.fundCorporation(corp.policyAddress)
    await chainA.grantOperatorAuthorization(corp.policyAddress)
    const eco = await chainA.createEcosystem(corp.policyAddress, { did: ecosystemDid })
    ecosystemId = eco.ecosystemId
    const orgSchema = await chainA.createCredentialSchema(corp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: ecsSchema('OrganizationCredential'),
    })
    orgSchemaId = orgSchema.schemaId
    const serviceSchema = await chainA.createCredentialSchema(corp.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: ecsSchema('ServiceCredential'),
    })
    serviceSchemaId = serviceSchema.schemaId
    corpPolicyAddress = corp.policyAddress
    const orgRoot = await chainA.createRootParticipant(corp.policyAddress, {
      schemaId: orgSchemaId,
      did: `did:example:org-root-${RUN_ID}`,
    })
    const serviceRoot = await chainA.createRootParticipant(corp.policyAddress, {
      schemaId: serviceSchema.schemaId,
      did: `did:example:service-root-${RUN_ID}`,
    })
    serviceRootId = serviceRoot.participantId

    const opV = await chainA.createFundedOperator()
    seederChain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: corp.policyAddress,
      logger,
    })
    await seederChain.start()
    validatorChain = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: opV.mnemonic,
      corporationAddress: corp.policyAddress,
      logger,
    })
    await validatorChain.start()

    const validatorMessages = new Subject<SubjectMessage>()
    const applicantMessages = new Subject<SubjectMessage>()
    childMessages = new Subject<SubjectMessage>()
    subjectMap = {
      'rxjs:validator': validatorMessages,
      'rxjs:applicant': applicantMessages,
      'rxjs:child': childMessages,
    }

    validator = await startAgent({
      label: 'Validator',
      domain: 'validator',
      didcommVersions: ['v1', 'v2'],
      veranaChain: validatorChain,
      indexer,
      vtFlowOptions: { assertVerifiableService: async () => true, autoIssueCredentialOnRequest: true },
    })
    validator.didcomm.registerInboundTransport(new SubjectInboundTransport(validatorMessages))
    validator.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    validator.dids.config.resolvers.unshift(resolver)
    await validator.initialize()
    await resolver.registerAgent(validator)
    validatorEvents = vi.spyOn(validator.events, 'emit')

    const vp = await chainA.startParticipantOp(corp.policyAddress, {
      role: PARTICIPANT_ROLE_ISSUER,
      validatorParticipantId: orgRoot.participantId,
      did: validator.did!,
      vsOperator: opV.address,
      vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
    })
    validatorParticipantId = vp.participantId
    await seederChain.setParticipantOPToValidated({ id: vp.participantId, opSummaryDigest: 'sha384-v' })

    await createJsc(validator, validator.publicApiBaseUrl, getEcsSchemas(validator.publicApiBaseUrl), {
      schemaBaseId: String(orgSchemaId),
      jsonSchemaRef: `vpr:verana:${validatorChain.getChainId}:cs:${orgSchemaId}`,
      precomputedDigestSRI: await computeSchemaDigest(JSON.parse(ecsSchema('OrganizationCredential'))),
    })

    applicant = await startAgent({
      label: 'Applicant',
      domain: 'applicant',
      didcommVersions: ['v1', 'v2'],
      veranaChain: seederChain,
      indexer,
      vtFlowOptions: {
        assertVerifiableService: async () => true,
        autoAcceptCredentialOffer: true,
        autoAcceptIssuanceRequest: true,
        autoIssueCredentialOnRequest: true,
        autoOfferCredential: true,
        buildCredentialOffer: async ({ record }) => {
          try {
            return await applicantOrchestrator.buildDirectIssuanceOffer(record.id)
          } catch (error) {
            logger.error(`buildCredentialOffer failed: ${(error as Error).message}`)
            return null
          }
        },
        verifyCredential: async ({ record }) => {
          for (let attempt = 1; ; attempt++) {
            try {
              await applicantOrchestrator.verifyOfferedCredential(record.id)
              return true
            } catch (error) {
              if (attempt >= 20) {
                logger.error(`verifyCredential failed: ${(error as Error).message}`)
                return false
              }
              await new Promise(r => setTimeout(r, 2000))
            }
          }
        },
        onCompleted: async ({ record }) => {
          try {
            await applicantOrchestrator.onCredentialCompleted(record.id)
          } catch (error) {
            logger.warn(`onCompleted: ${(error as Error).message}`)
          }
        },
        onCredentialRevoked: async ({ record }) => {
          try {
            await applicantOrchestrator.onCredentialRevoked(record.id)
          } catch (error) {
            logger.warn(`onCredentialRevoked: ${(error as Error).message}`)
          }
        },
      },
    })
    applicant.didcomm.registerInboundTransport(new SubjectInboundTransport(applicantMessages))
    applicant.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    applicant.dids.config.resolvers.unshift(resolver)
    await applicant.initialize()
    await resolver.registerAgent(applicant)
    applicantEvents = vi.spyOn(applicant.events, 'emit')
    applicantOrchestrator = new VtFlowOrchestrator(applicant, {
      publicApiBaseUrl: applicant.publicApiBaseUrl,
    })

    await until(async () => {
      const issuers = await indexer.listParticipants({
        role: ParticipantRole.Issuer,
        participantState: ParticipantState.Active,
      })
      return issuers.some(p => p.id === validatorParticipantId) ? true : undefined
    })
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await applicant?.shutdown().catch(() => undefined)
    await validator?.shutdown().catch(() => undefined)
    chainA?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  it(
    'bootstraps, onboards over DIDComm, issues, revokes, and renews',
    async () => {
      const bootstrap = new EcsBootstrapService(
        applicant,
        indexer,
        { mode: 'standalone', trustedEcosystemDids: [ecosystemDid] },
        logger,
      )
      await bootstrap.run()

      const holderOp = await until(async () => {
        const list = await indexer.listParticipants({ did: applicant.did!, role: ParticipantRole.Holder })
        return list[0]
      })
      expect(Number(holderOp.validator_participant_id)).toBe(validatorParticipantId)
      const serviceOp = await until(async () => {
        const list = await indexer.listParticipants({ did: applicant.did!, role: ParticipantRole.Issuer })
        return list[0]
      })
      expect(serviceOp.op_state).toBe('PENDING')
      serviceOpId = serviceOp.id

      const validatorAwaitingOr = waitForEvent(
        validatorEvents,
        isVtFlowStateChangedEvent(VtFlowState.AwaitingOr),
      )
      const orRecord = await applicantOrchestrator.startOnboardingProcess({
        applicantParticipantId: holderOp.id,
        claims: { name: 'Applicant Org' },
      })
      expect(orRecord.state).toBe(VtFlowState.OrSent)
      await validatorAwaitingOr

      const { VtFlowsService } = await import('../../src/controllers/admin/vt-flow/VtFlowsService')
      const flowsService = new VtFlowsService(
        { getAgent: async () => validator } as never,
        undefined as never,
      )

      const applicantCompleted = waitForEvent(
        applicantEvents,
        isVtFlowStateChangedEvent(VtFlowState.Completed),
      )
      const validatorFlow = (await flowsService.listFlows({ role: VtFlowRole.Validator }))[0]
      const orchestrator = new VtFlowOrchestrator(validator, {
        publicApiBaseUrl: validator.publicApiBaseUrl,
      })
      // This applicant is a HOLDER, so the validation builds the credential and the offer sends it.
      const {
        record: validatedRecord,
        participant,
        credential,
      } = await orchestrator.validateOnboardingProcess({
        vtFlowRecordId: validatorFlow.id,
        credentialSchemaId: String(orgSchemaId),
      })
      const validated = await orchestrator.offerOnboardingCredential({
        vtFlowRecordId: validatedRecord.id,
        credentialSchemaId: String(orgSchemaId),
        participant,
        credential,
      })
      expect(validated.state).toBe(VtFlowState.CredOffered)
      await applicantCompleted
      await waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Completed))

      expect(await until(() => indexer.getParticipant(holderOp.id))).toBeDefined()

      const credentials = await applicant.w3cCredentials.getAll()
      expect(credentials.length).toBeGreaterThan(0)
      const credentialCountBeforeRevoke = credentials.length

      const completedFlows = await flowsService.listFlows({ role: VtFlowRole.Validator })
      expect(completedFlows).toHaveLength(1)
      expect(completedFlows[0].state).toBe(VtFlowState.Completed)

      const applicantRevoked = waitForEvent(
        applicantEvents,
        isVtFlowStateChangedEvent(VtFlowState.CredRevoked),
      )
      const revoked = await flowsService.revokeCredential(orRecord.participantSessionId, 'lifecycle test')
      expect(revoked.state).toBe(VtFlowState.CredRevoked)
      await applicantRevoked

      await until(async () => {
        const remaining = await applicant.w3cCredentials.getAll()
        return remaining.length < credentialCountBeforeRevoke ? true : undefined
      })

      await seederChain.renewParticipantOP(holderOp.id)
      validatorEvents.mockClear()
      const validatorRenewal = waitForEvent(
        validatorEvents,
        isVtFlowStateChangedEvent(VtFlowState.AwaitingOr),
      )
      const renewalRecord = await applicantOrchestrator.startOnboardingProcess({
        applicantParticipantId: holderOp.id,
      })
      expect(renewalRecord.participantSessionId).toBe(orRecord.participantSessionId)
      await validatorRenewal

      const renewedFlows = await flowsService.listFlows({ role: VtFlowRole.Validator })
      expect(renewedFlows).toHaveLength(1)
      expect(renewedFlows[0].state).toBe(VtFlowState.AwaitingOr)

      await seederChain.cancelParticipantOPLastRequest(holderOp.id)
      await reconcileVtFlowRecordsOnCancel(validator, String(holderOp.id))
      await reconcileVtFlowRecordsOnCancel(applicant, String(holderOp.id))

      const restoredFlows = await flowsService.listFlows({ role: VtFlowRole.Validator })
      expect(restoredFlows).toHaveLength(1)
      expect(restoredFlows[0].state).toBe(VtFlowState.Completed)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'onboards a delegated child as a HOLDER of the parent Service credential',
    async () => {
      await seederChain.cancelParticipantOPLastRequest(serviceOpId)
      const opP = await chainA.createFundedOperator()
      // The parent is the validator of the child's onboarding process, so it also signs the outcome.
      const parentServiceOp = await chainA.startParticipantOp(corpPolicyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: serviceRootId,
        did: applicant.did!,
        vsOperator: opP.address,
        vsOperatorAuthzMsgTypes: [PP_VALIDATE, PP_SESSION],
      })
      applicantIssuerParticipantId = parentServiceOp.participantId
      await seederChain.setParticipantOPToValidated({
        id: parentServiceOp.participantId,
        opSummaryDigest: 'sha384-s',
      })
      const parentChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: opP.mnemonic,
        corporationAddress: corpPolicyAddress,
        logger,
      })
      await parentChain.start()
      ;(applicant as { veranaChain?: VeranaChainService }).veranaChain = parentChain

      await createJsc(applicant, applicant.publicApiBaseUrl, getEcsSchemas(applicant.publicApiBaseUrl), {
        schemaBaseId: String(serviceSchemaId),
        jsonSchemaRef: `vpr:verana:${seederChain.getChainId}:cs:${serviceSchemaId}`,
        precomputedDigestSRI: await computeSchemaDigest(JSON.parse(ecsSchema('ServiceCredential'))),
      })
      await until(async () => {
        const issuers = await indexer.listParticipants({
          did: applicant.did!,
          role: ParticipantRole.Issuer,
          participantState: ParticipantState.Active,
        })
        return issuers.length > 0 ? true : undefined
      })

      // The child pays for its own StartParticipantOP, so its operator needs the authorization.
      const opC = await chainA.createFundedOperator()
      await chainA.grantOperatorAuthorization(corpPolicyAddress, opC.address, [PP_START_OP])
      const childChain = new VeranaChainService({
        rpcUrl: stack.rpcUrl,
        mnemonic: opC.mnemonic,
        corporationAddress: corpPolicyAddress,
        logger,
      })
      await childChain.start()

      let childOrchestrator: VtFlowOrchestrator | undefined
      const child = await startAgent({
        label: 'Child',
        domain: 'child',
        didcommVersions: ['v1', 'v2'],
        veranaChain: childChain,
        indexer,
        vtFlowOptions: {
          assertVerifiableService: async () => true,
          autoAcceptCredentialOffer: true,
          verifyCredential: async ({ record }) => {
            for (let attempt = 1; ; attempt++) {
              try {
                await childOrchestrator!.verifyOfferedCredential(record.id)
                return true
              } catch (error) {
                if (attempt >= 20) {
                  logger.error(`child verifyCredential failed: ${(error as Error).message}`)
                  return false
                }
                await new Promise(r => setTimeout(r, 2000))
              }
            }
          },
        },
      })
      child.didcomm.registerInboundTransport(new SubjectInboundTransport(childMessages))
      child.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      child.dids.config.resolvers.unshift(resolver)
      await child.initialize()
      await resolver.registerAgent(child)
      const childEvents = vi.spyOn(child.events, 'emit')
      childOrchestrator = new VtFlowOrchestrator(child, {
        publicApiBaseUrl: child.publicApiBaseUrl,
      })

      // [VSA-VTI-FLOW-OP-NEW] step 1: delegated bootstrap only submits StartParticipantOP.
      const bootstrap = new EcsBootstrapService(
        child,
        indexer,
        { mode: 'delegated', delegatedParentVsDid: applicant.did!, verifyPeer: async () => true },
        logger,
      )
      await bootstrap.run()

      const childHolder = await until(async () => {
        const [holder] = await indexer.listParticipants({
          did: child.did!,
          role: ParticipantRole.Holder,
          schemaId: serviceSchemaId,
        })
        return holder
      })
      expect(Number(childHolder.validator_participant_id)).toBe(applicantIssuerParticipantId)

      const childCompleted = waitForEvent(childEvents, isVtFlowStateChangedEvent(VtFlowState.Completed))

      // Steps 2 and 3. In production the indexer StartParticipantOP handler does this; this stack
      // wires no indexer WebSocket, so the test stands in for it.
      await childOrchestrator.startOnboardingProcess({ applicantParticipantId: childHolder.id })

      // The parent operator fills the Service claims while the flow waits, then validates and offers.
      const parentVtFlowApi = applicant.dependencyManager.resolve(VtFlowApi)
      const parentFlow = await until(async () => {
        const [flow] = await parentVtFlowApi.findAllByQuery({
          role: VtFlowRole.Validator,
          participantId: String(childHolder.id),
        })
        return flow?.state === VtFlowState.AwaitingOr ? flow : undefined
      })
      await parentVtFlowApi.updateClaims(parentFlow.id, { name: 'Child Service' })

      const parentOrchestrator = new VtFlowOrchestrator(applicant, {
        publicApiBaseUrl: applicant.publicApiBaseUrl,
      })
      const { record, participant, credential } = await parentOrchestrator.validateOnboardingProcess({
        vtFlowRecordId: parentFlow.id,
        credentialSchemaId: String(serviceSchemaId),
      })
      await parentOrchestrator.offerOnboardingCredential({
        vtFlowRecordId: record.id,
        credentialSchemaId: String(serviceSchemaId),
        participant,
        credential,
      })

      await childCompleted
      const childCredentials = await child.w3cCredentials.getAll()
      expect(childCredentials.length).toBeGreaterThan(0)

      await child.shutdown().catch(() => undefined)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'detaches the VTJSCs of an ecosystem it stops controlling, keeps serving them, and re-attaches on return',
    async () => {
      const chainId = validatorChain.getChainId
      const schemaRef = `vpr:verana:${chainId}:cs:${orgSchemaId}`
      const serviceId = `${validator.did}#vpr-schemas-${orgSchemaId}-vtjsc-vp`

      const jscKeys = async () => {
        const [didRecord] = await validator.dids.getCreatedDids({ did: validator.did })
        return Object.keys(didRecord.metadata.get('_vt/jsc') ?? {})
      }
      const serviceIds = async () => {
        const [didRecord] = await validator.dids.getCreatedDids({ did: validator.did })
        return (didRecord.didDocument?.service ?? []).map(service => service.id)
      }

      // beforeAll published this one with createJsc, against the ecosystem of corporation 1.
      expect(await jscKeys()).toContain(schemaRef)
      expect(await serviceIds()).toContain(serviceId)

      // startAgent skips setupSelfTr, so seed the URL-keyed entry it would have left in this same
      // bucket. No reconciliation may take it: it says nothing about who governs an ecosystem.
      const selfTrKey = `${validator.publicApiBaseUrl}/vt/schemas-example-service-jsc.json`
      const [seedRecord] = await validator.dids.getCreatedDids({ did: validator.did })
      seedRecord.metadata.set('_vt/jsc', {
        ...(seedRecord.metadata.get('_vt/jsc') ?? {}),
        [selfTrKey]: { credential: {}, verifiablePresentation: {}, didDocumentServiceId: '' },
      })
      await validator.context.dependencyManager.resolve(DidRepository).update(validator.context, seedRecord)

      const selfTrKeys = (await jscKeys()).filter(key => !key.startsWith('vpr:verana:'))
      expect(selfTrKeys).toContain(selfTrKey)
      const otherServiceIds = (await serviceIds()).filter(id => id !== serviceId)

      const ownCorporationId = Number((await indexer.getEcosystem(ecosystemId)).corporation_id)

      // Rebinding the agent to another Corporation is exactly this: VERANA_CORPORATION_ID changes.
      const otherCorp = await chainA.createCorporation({ did: `did:example:corp2-${RUN_ID}` })
      await chainA.fundCorporation(otherCorp.policyAddress)
      await chainA.grantOperatorAuthorization(otherCorp.policyAddress)
      const otherEco = await chainA.createEcosystem(otherCorp.policyAddress, {
        did: `did:example:eco2-${RUN_ID}`,
      })
      const otherCorporationId = await until(async () => {
        const id = Number((await indexer.getEcosystem(otherEco.ecosystemId)).corporation_id)
        return Number.isFinite(id) && id !== ownCorporationId ? id : undefined
      })

      await reconcileVtjscPublications(validator, indexer, otherCorporationId)

      // The DID Document stops advertising it...
      expect(await serviceIds()).not.toContain(serviceId)
      expect(await serviceIds()).toEqual(expect.arrayContaining(otherServiceIds))

      // ...but keeps serving it, so credentials naming that URL stay verifiable.
      expect(await jscKeys()).toContain(schemaRef)
      expect(await jscKeys()).toEqual(expect.arrayContaining(selfTrKeys))

      // Coming back re-attaches what it already holds; the digest matches, so nothing is rebuilt.
      await reconcileVtjscPublications(validator, indexer, ownCorporationId)

      expect(await serviceIds()).toContain(serviceId)
      expect(await jscKeys()).toContain(schemaRef)

      // The pass also publishes the AnonCreds schema of the VTJSC, per [VSA-PUB-AC-5]. beforeAll
      // built the VTJSC with createJsc alone, so this agent stands for one deployed before the rule.
      const jsonSchemaCredentialId = `${validator.publicApiBaseUrl}/vt/schemas-${orgSchemaId}-jsc.json`
      const publishedSchemas = () =>
        validator.modules.anoncreds.getCreatedSchemas({
          relatedJsonSchemaCredentialId: jsonSchemaCredentialId,
        })

      const [anonCredsSchema] = await publishedSchemas()
      expect(anonCredsSchema.schema).toMatchObject({
        name: 'OrganizationCredential',
        attrNames: ['id', 'name'],
        issuerId: validator.did,
      })

      // An issuer of another DID reads the schema from this listing, so it must carry the tag.
      const listed = await findAttestedResources(validator, {
        resourceType: 'anonCredsSchema',
        relatedJsonSchemaCredentialId: jsonSchemaCredentialId,
      })
      expect(listed.map(record => (record.content as { id: string }).id)).toEqual([anonCredsSchema.schemaId])

      // A second run must leave it attached, which is what proves the two passes agree.
      await reconcileVtjscPublications(validator, indexer, ownCorporationId)
      expect(await serviceIds()).toContain(serviceId)
      expect(await publishedSchemas()).toHaveLength(1)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'rebuilds the self-issued ECS credential when its stored proof leaves the DID Document',
    async () => {
      const baseUrl = applicant.publicApiBaseUrl
      const didRecordOf = async () => (await applicant.dids.getCreatedDids({ did: applicant.did }))[0]
      const storedEntry = async (key: string) => (await didRecordOf()).metadata.get('_vt/vtc')?.[key]

      const jscUrl = await resolveJsonSchemaCredentialId(
        applicant,
        indexer,
        serviceSchemaId,
        seederChain.getChainId,
      )
      const rebind = async () =>
        await rebindEcsCredentialSchema(
          applicant,
          baseUrl,
          String(serviceSchemaId),
          'ecs-service',
          ecsClaims,
          jscUrl,
          applicantIssuerParticipantId,
        )

      await rebind()
      const stored = await storedEntry(jscUrl)
      expect(stored?.credential?.proof?.verificationMethod).toBeDefined()
      const integrityData = stored.integrityData

      const rotated = `${applicant.did}#rotated-key`
      const didRecord = await didRecordOf()
      const record = didRecord.metadata.get('_vt/vtc') ?? {}
      record[jscUrl].credential.proof.verificationMethod = rotated
      didRecord.metadata.set('_vt/vtc', record)
      await applicant.context.dependencyManager.resolve(DidRepository).update(applicant.context, didRecord)
      expect((await storedEntry(jscUrl)).credential.proof.verificationMethod).toBe(rotated)

      await rebind()

      const rebuilt = await storedEntry(jscUrl)
      const assertionMethods = ((await didRecordOf()).didDocument?.assertionMethod ?? []).map(entry =>
        typeof entry === 'string' ? entry : entry.id,
      )
      expect(rebuilt.integrityData).toBe(integrityData)
      expect(rebuilt.credential.proof.verificationMethod).not.toBe(rotated)
      expect(assertionMethods).toContain(rebuilt.credential.proof.verificationMethod)
      expect(rebuilt.credential.credentialSchema.id).toBe(jscUrl)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'withdraws the self-issued ECS credential when its ISSUER participant is revoked on chain',
    async () => {
      const baseUrl = applicant.publicApiBaseUrl
      const vtcEntries = async () =>
        Object.keys(
          (await applicant.dids.getCreatedDids({ did: applicant.did }))[0].metadata.get('_vt/vtc') ?? {},
        )
      const serviceIds = async () =>
        (await applicant.dids.getCreatedDids({ did: applicant.did }))[0].didDocument?.service?.map(
          s => s.id,
        ) ?? []

      const jscUrl = await resolveJsonSchemaCredentialId(
        applicant,
        indexer,
        serviceSchemaId,
        seederChain.getChainId,
      )
      await rebindEcsCredentialSchema(
        applicant,
        baseUrl,
        String(serviceSchemaId),
        'ecs-service',
        ecsClaims,
        jscUrl,
        applicantIssuerParticipantId,
      )

      const linkedVpServiceId = `${applicant.did}#vpr-schemas-service-vtc-vp`
      expect(await vtcEntries()).toContain(jscUrl)
      expect(await serviceIds()).toContain(linkedVpServiceId)

      await chainA.revokeParticipant(corpPolicyAddress, applicantIssuerParticipantId)
      await until(async () => {
        const p = await indexer.getParticipant(applicantIssuerParticipantId).catch(() => undefined)
        return p?.revoked ? true : undefined
      })

      await removeSelfIssuedEcsCredentialsIfIssuerRevoked(applicant, String(applicantIssuerParticipantId))

      expect(await vtcEntries()).not.toContain(jscUrl)
      expect(await serviceIds()).not.toContain(linkedVpServiceId)
      // nothing is republished: withdrawal withdraws
      expect(await vtcEntries()).not.toContain(`${baseUrl}/vt/schemas-example-service-jsc.json`)
    },
    SETUP_TIMEOUT_MS,
  )
  describe('the AnonCreds trust decision', () => {
    const stranger = `did:example:stranger-${RUN_ID}`
    const claims = [{ name: 'name', value: 'Test Credential' }]

    let validatorDid: string
    let trustSchemaId: number
    let trustRootParticipantId: number
    let trustParticipantId: number
    let jsonSchemaCredentialId: string
    let anonCredsSchemaId: string
    let credentialDefinitionId: string
    let controller: V2DidcommCredentialExchangesController
    let presentations: V2DidcommPresentationsController

    const offerBody = () => ({ credentialDefinitionId, claims })

    const untilParticipantCount = (role: ParticipantRole, count: number) =>
      until(async () => {
        const participants = await indexer.listParticipants({
          did: validatorDid,
          role,
          schemaId: trustSchemaId,
          participantState: ParticipantState.Active,
        })
        return participants.length === count ? true : undefined
      })

    beforeAll(async () => {
      if (!validator.did) throw new Error('the validator agent has no public DID')
      validatorDid = validator.did

      const ecosystem = await chainA.createEcosystem(corpPolicyAddress, { did: validatorDid })
      const schema = await chainA.createCredentialSchema(corpPolicyAddress, {
        ecosystemId: ecosystem.ecosystemId,
        jsonSchema: ecsSchema('AnonCredsTrustCredential'),
      })
      trustSchemaId = schema.schemaId

      const root = await chainA.createRootParticipant(corpPolicyAddress, {
        schemaId: trustSchemaId,
        did: `did:example:trust-root-${RUN_ID}`,
      })
      trustRootParticipantId = root.participantId
      const participant = await chainA.startParticipantOp(corpPolicyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: trustRootParticipantId,
        did: validatorDid,
      })
      trustParticipantId = participant.participantId

      const vtjsc = (await createJsc(
        validator,
        validator.publicApiBaseUrl,
        getEcsSchemas(validator.publicApiBaseUrl),
        {
          schemaBaseId: String(trustSchemaId),
          jsonSchemaRef: `vpr:verana:${validatorChain.getChainId}:cs:${trustSchemaId}`,
          precomputedDigestSRI: await computeSchemaDigest(JSON.parse(ecsSchema('AnonCredsTrustCredential'))),
        },
      )) as { id: string }
      jsonSchemaCredentialId = vtjsc.id
      mockResponses[jsonSchemaCredentialId] = vtjsc

      const attestedResources: Record<string, unknown> = {}
      const registryPrototype = WebVhAnonCredsRegistry.prototype as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >
      const resolveAttestedResource = registryPrototype._resolveAndValidateAttestedResource
      vi.spyOn(registryPrototype, '_resolveAndValidateAttestedResource').mockImplementation(async function (
        this: unknown,
        ...args: unknown[]
      ) {
        const resource = attestedResources[args[1] as string]
        if (!resource) return resolveAttestedResource.call(this, ...args)
        return { resolutionResult: { content: resource }, resourceObject: resource }
      })

      const { schemaState, registrationMetadata: schemaRegistration } =
        await validator.modules.anoncreds.registerSchema({
          schema: {
            attrNames: ['name'],
            name: 'AnonCredsTrustCredential',
            version: String(trustSchemaId),
            issuerId: validatorDid,
          },
          options: { extraMetadata: { relatedJsonSchemaCredentialId: jsonSchemaCredentialId } },
        })
      if (!schemaState.schemaId) throw new Error(`the AnonCreds schema is absent: ${schemaState.state}`)
      anonCredsSchemaId = schemaState.schemaId
      attestedResources[anonCredsSchemaId] = (
        schemaRegistration as { attestedResource: Record<string, unknown> }
      ).attestedResource

      const schemaRepository = validator.dependencyManager.resolve(AnonCredsSchemaRepository)
      const schemaRecord = await schemaRepository.getBySchemaId(validator.context, anonCredsSchemaId)
      schemaRecord.setTag('relatedJsonSchemaCredentialId', jsonSchemaCredentialId)
      await schemaRepository.update(validator.context, schemaRecord)

      const { credentialDefinitionState, registrationMetadata: credentialDefinitionRegistration } =
        await validator.modules.anoncreds.registerCredentialDefinition({
          credentialDefinition: {
            issuerId: validatorDid,
            schemaId: anonCredsSchemaId,
            tag: `trust.${trustSchemaId}`,
          },
          options: {
            supportRevocation: false,
            extraMetadata: { relatedJsonSchemaCredentialId: jsonSchemaCredentialId },
          },
        })
      if (!credentialDefinitionState.credentialDefinitionId) {
        throw new Error(`the credential definition is absent: ${credentialDefinitionState.state}`)
      }
      credentialDefinitionId = credentialDefinitionState.credentialDefinitionId
      attestedResources[credentialDefinitionId] = (
        credentialDefinitionRegistration as { attestedResource: Record<string, unknown> }
      ).attestedResource

      const credentialDefinitionRepository = validator.dependencyManager.resolve(
        AnonCredsCredentialDefinitionRepository,
      )
      const credentialDefinitionRecord = await credentialDefinitionRepository.getByCredentialDefinitionId(
        validator.context,
        credentialDefinitionId,
      )
      credentialDefinitionRecord.setTag('relatedJsonSchemaCredentialId', jsonSchemaCredentialId)
      await credentialDefinitionRepository.update(validator.context, credentialDefinitionRecord)

      controller = new V2DidcommCredentialExchangesController(
        { getAgent: async () => validator } as never,
        { createShortUrl: async () => 'short-trust' } as never,
        validator.publicApiBaseUrl,
      )
      presentations = new V2DidcommPresentationsController(
        { getAgent: async () => validator } as never,
        { createShortUrl: async () => 'short-trust' } as never,
        new CredentialTypesService({ getAgent: async () => validator } as never),
        validator.publicApiBaseUrl,
      )
    }, SETUP_TIMEOUT_MS)

    it(
      'refuses an offer until the chain validates the ISSUER Participant',
      async () => {
        const error = await controller.createCredentialOffer(offerBody() as never).catch(caught => caught)

        expect(error).toBeInstanceOf(AdminApiError)
        expect(error.code).toBe('NOT_AUTHORIZED')
        expect(error.status).toBe(409)

        await seederChain.setParticipantOPToValidated({
          id: trustParticipantId,
          opSummaryDigest: 'sha384-trust',
        })
        await untilParticipantCount(ParticipantRole.Issuer, 1)

        const offer = await controller.createCredentialOffer(offerBody() as never)
        expect(offer.credentialExchangeId).toBeDefined()
      },
      SETUP_TIMEOUT_MS,
    )

    it(
      'derives the CredentialSchema and the Ecosystem DID from the indexer',
      async () => {
        const fromCredentialDefinition = await validator.anonCredsTrust.deriveCredentialSchema({
          credentialDefinitionId,
        })

        expect(fromCredentialDefinition).toEqual({
          credentialSchemaId: trustSchemaId,
          ecosystemDid: validatorDid,
          jsonSchemaCredentialId,
          anonCredsSchemaId,
          issuerId: validatorDid,
        })

        const fromSchema = await validator.anonCredsTrust.deriveCredentialSchema({
          schemaId: anonCredsSchemaId,
        })

        expect(fromSchema.credentialSchemaId).toBe(trustSchemaId)
        expect(fromSchema.ecosystemDid).toBe(validatorDid)
        expect(fromSchema.issuerId).toBeUndefined()
      },
      SETUP_TIMEOUT_MS,
    )

    it(
      'reads the Participant entries of the indexer at the present time',
      async () => {
        await expect(
          validator.anonCredsTrust.assertAuthorized({
            did: validatorDid,
            role: ParticipantRole.Issuer,
            credentialSchemaId: trustSchemaId,
          }),
        ).resolves.toBeUndefined()

        await expect(
          validator.anonCredsTrust.assertAuthorized({
            did: stranger,
            role: ParticipantRole.Issuer,
            credentialSchemaId: trustSchemaId,
          }),
        ).rejects.toThrow('holds no active ISSUER Participant')

        await expect(
          validator.anonCredsTrust.assertAuthorized({
            did: validatorDid,
            role: ParticipantRole.Verifier,
            credentialSchemaId: trustSchemaId,
          }),
        ).rejects.toThrow('holds no active VERIFIER Participant')

        const result = await validator.anonCredsTrust.findUnaccreditedDids(
          [validatorDid, stranger],
          ParticipantRole.Issuer,
          trustSchemaId,
        )

        expect(result).toEqual({ unaccredited: [stranger], unchecked: [] })
      },
      SETUP_TIMEOUT_MS,
    )

    it(
      'offers a credential while it holds the ISSUER Participant, and refuses once the chain revokes it',
      async () => {
        const offer = await controller.createCredentialOffer(offerBody() as never)
        expect(offer.credentialExchangeId).toBeDefined()

        await chainA.revokeParticipant(corpPolicyAddress, trustParticipantId)
        await untilParticipantCount(ParticipantRole.Issuer, 0)

        const error = await controller.createCredentialOffer(offerBody() as never).catch(caught => caught)

        expect(error).toBeInstanceOf(AdminApiError)
        expect(error.code).toBe('NOT_AUTHORIZED')
        expect(error.status).toBe(409)
      },
      SETUP_TIMEOUT_MS,
    )

    it(
      'requests a presentation once the chain validates the VERIFIER Participant, and refuses once it revokes it',
      async () => {
        const byCredentialDefinition = () => ({ requestedCredentials: [{ credentialDefinitionId }] })
        const byJsonSchemaCredential = () => ({ requestedCredentials: [{ jsonSchemaCredentialId }] })

        for (const body of [byCredentialDefinition(), byJsonSchemaCredential()]) {
          const error = await presentations.createPresentationRequest(body as never).catch(caught => caught)

          expect(error).toBeInstanceOf(AdminApiError)
          expect(error.code).toBe('NOT_AUTHORIZED')
          expect(error.status).toBe(409)
        }

        const verifier = await chainA.startParticipantOp(corpPolicyAddress, {
          role: PARTICIPANT_ROLE_VERIFIER,
          validatorParticipantId: trustRootParticipantId,
          did: validatorDid,
        })
        await seederChain.setParticipantOPToValidated({
          id: verifier.participantId,
          opSummaryDigest: 'sha384-verifier',
        })
        await untilParticipantCount(ParticipantRole.Verifier, 1)

        const cases = [
          [byCredentialDefinition(), { cred_def_id: credentialDefinitionId }],
          [byJsonSchemaCredential(), { schema_id: anonCredsSchemaId }],
        ] as const

        for (const [body, restriction] of cases) {
          const { proofExchangeId } = await presentations.createPresentationRequest(body as never)

          const { request } = await validator.didcomm.proofs.getFormatData(proofExchangeId)
          const groups = Object.values(request?.anoncreds?.requested_attributes ?? {})
          expect(groups[0]?.restrictions).toEqual([restriction])
        }

        await chainA.revokeParticipant(corpPolicyAddress, verifier.participantId)
        await untilParticipantCount(ParticipantRole.Verifier, 0)

        const error = await presentations
          .createPresentationRequest(byCredentialDefinition() as never)
          .catch(caught => caught)

        expect(error).toBeInstanceOf(AdminApiError)
        expect(error.code).toBe('NOT_AUTHORIZED')
        expect(error.status).toBe(409)
      },
      SETUP_TIMEOUT_MS,
    )

    it(
      'answers RESOLVER_UNAVAILABLE, and starts no exchange, while the indexer is unreachable',
      async () => {
        const reachable = validator.indexer
        validator.indexer = new VeranaIndexerService({ baseUrl: 'http://127.0.0.1:1', logger })

        const credentialExchanges = (await validator.didcomm.credentials.getAll()).length
        const proofExchanges = (await validator.didcomm.proofs.getAll()).length

        try {
          const offerError = await controller.createCredentialOffer(offerBody() as never).catch(c => c)
          expect(offerError).toBeInstanceOf(AdminApiError)
          expect(offerError.code).toBe('RESOLVER_UNAVAILABLE')
          expect(offerError.status).toBe(503)

          const requestError = await presentations
            .createPresentationRequest({ requestedCredentials: [{ credentialDefinitionId }] } as never)
            .catch(c => c)
          expect(requestError).toBeInstanceOf(AdminApiError)
          expect(requestError.code).toBe('RESOLVER_UNAVAILABLE')
          expect(requestError.status).toBe(503)

          expect((await validator.didcomm.credentials.getAll()).length).toBe(credentialExchanges)
          expect((await validator.didcomm.proofs.getAll()).length).toBe(proofExchanges)
        } finally {
          validator.indexer = reachable
        }
      },
      SETUP_TIMEOUT_MS,
    )

    describe('the holder and the prover, over a connection to the validator', () => {
      let holderCredentials: V2DidcommCredentialExchangesController
      let holderPresentations: V2DidcommPresentationsController
      let holderSchemaId: number
      let holderRootParticipantId: number
      let holderCredentialDefinitionId: string
      let issuerParticipantId: number
      let refusedOfferId: string
      let refusedRequestId: string

      const holderOfferBody = () => ({ credentialDefinitionId: holderCredentialDefinitionId, claims })

      const untilHolderParticipantCount = (role: ParticipantRole, count: number) =>
        until(async () => {
          const participants = await indexer.listParticipants({
            did: validatorDid,
            role,
            schemaId: holderSchemaId,
            participantState: ParticipantState.Active,
          })
          return participants.length === count ? true : undefined
        })

      const receiveOffer = async (invitation: unknown) => {
        const known = new Set((await applicant.didcomm.credentials.getAll()).map(record => record.id))
        await applicant.didcomm.oob.receiveInvitationFromUrl(
          invitationUrl(invitation as Record<string, unknown>),
          { label: applicant.label },
        )
        return until(async () =>
          (await applicant.didcomm.credentials.getAll()).find(
            record => !known.has(record.id) && record.state === DidCommCredentialState.OfferReceived,
          ),
        )
      }

      const receiveRequest = async (invitation: unknown) => {
        const known = new Set((await applicant.didcomm.proofs.getAll()).map(record => record.id))
        await applicant.didcomm.oob.receiveInvitationFromUrl(
          invitationUrl(invitation as Record<string, unknown>),
          { label: applicant.label },
        )
        return until(async () =>
          (await applicant.didcomm.proofs.getAll()).find(
            record => !known.has(record.id) && record.state === DidCommProofState.RequestReceived,
          ),
        )
      }

      const untilState = (id: string, state: DidCommCredentialState) =>
        until(async () =>
          (await validator.didcomm.credentials.getById(id)).state === state ? id : undefined,
        )

      // The chain holds one validation process per schema, role, accreditor and corporation, and
      // the sibling tests own the contexts of `trustSchemaId`. This block therefore governs its
      // AnonCreds objects with a CredentialSchema of its own.
      beforeAll(async () => {
        holderCredentials = new V2DidcommCredentialExchangesController(
          { getAgent: async () => applicant } as never,
          { createShortUrl: async () => 'short-holder' } as never,
          applicant.publicApiBaseUrl,
        )
        holderPresentations = new V2DidcommPresentationsController(
          { getAgent: async () => applicant } as never,
          { createShortUrl: async () => 'short-holder' } as never,
          new CredentialTypesService({ getAgent: async () => applicant } as never),
          applicant.publicApiBaseUrl,
        )

        const governed = await indexer.getCredentialSchema(trustSchemaId)
        const schema = await chainA.createCredentialSchema(corpPolicyAddress, {
          ecosystemId: governed!.ecosystem_id,
          jsonSchema: ecsSchema('HolderTrustCredential'),
        })
        holderSchemaId = schema.schemaId

        const root = await chainA.createRootParticipant(corpPolicyAddress, {
          schemaId: holderSchemaId,
          did: `did:example:holder-root-${RUN_ID}`,
        })
        holderRootParticipantId = root.participantId

        const issuer = await chainA.startParticipantOp(corpPolicyAddress, {
          role: PARTICIPANT_ROLE_ISSUER,
          validatorParticipantId: holderRootParticipantId,
          did: validatorDid,
        })
        issuerParticipantId = issuer.participantId
        await seederChain.setParticipantOPToValidated({
          id: issuerParticipantId,
          opSummaryDigest: 'sha384-holderissuer',
        })
        await untilHolderParticipantCount(ParticipantRole.Issuer, 1)

        const vtjsc = (await createJsc(
          validator,
          validator.publicApiBaseUrl,
          getEcsSchemas(validator.publicApiBaseUrl),
          {
            schemaBaseId: String(holderSchemaId),
            jsonSchemaRef: `vpr:verana:${validatorChain.getChainId}:cs:${holderSchemaId}`,
            precomputedDigestSRI: await computeSchemaDigest(JSON.parse(ecsSchema('HolderTrustCredential'))),
          },
        )) as { id: string }
        mockResponses[vtjsc.id] = vtjsc

        // The sibling spy serves its own objects only, so this one answers for these and delegates
        // the rest to it.
        const attested: Record<string, unknown> = {}
        const registryPrototype = WebVhAnonCredsRegistry.prototype as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
        const delegate = registryPrototype._resolveAndValidateAttestedResource
        registryPrototype._resolveAndValidateAttestedResource = async function (
          this: unknown,
          ...args: unknown[]
        ) {
          const resource = attested[args[1] as string]
          if (!resource) return delegate.call(this, ...args)
          return { resolutionResult: { content: resource }, resourceObject: resource }
        }

        const { schemaState, registrationMetadata: schemaRegistration } =
          await validator.modules.anoncreds.registerSchema({
            schema: {
              attrNames: ['name'],
              name: 'HolderTrustCredential',
              version: String(holderSchemaId),
              issuerId: validatorDid,
            },
            options: { extraMetadata: { relatedJsonSchemaCredentialId: vtjsc.id } },
          })
        if (!schemaState.schemaId) throw new Error(`the AnonCreds schema is absent: ${schemaState.state}`)
        attested[schemaState.schemaId] = (
          schemaRegistration as { attestedResource: Record<string, unknown> }
        ).attestedResource

        const schemaRepository = validator.dependencyManager.resolve(AnonCredsSchemaRepository)
        const schemaRecord = await schemaRepository.getBySchemaId(validator.context, schemaState.schemaId)
        schemaRecord.setTag('relatedJsonSchemaCredentialId', vtjsc.id)
        await schemaRepository.update(validator.context, schemaRecord)

        const { credentialDefinitionState, registrationMetadata: credentialDefinitionRegistration } =
          await validator.modules.anoncreds.registerCredentialDefinition({
            credentialDefinition: {
              issuerId: validatorDid,
              schemaId: schemaState.schemaId,
              tag: `holder.${holderSchemaId}`,
            },
            options: {
              supportRevocation: false,
              extraMetadata: { relatedJsonSchemaCredentialId: vtjsc.id },
            },
          })
        if (!credentialDefinitionState.credentialDefinitionId) {
          throw new Error(`the credential definition is absent: ${credentialDefinitionState.state}`)
        }
        holderCredentialDefinitionId = credentialDefinitionState.credentialDefinitionId
        attested[holderCredentialDefinitionId] = (
          credentialDefinitionRegistration as { attestedResource: Record<string, unknown> }
        ).attestedResource

        const credentialDefinitionRepository = validator.dependencyManager.resolve(
          AnonCredsCredentialDefinitionRepository,
        )
        const credentialDefinitionRecord = await credentialDefinitionRepository.getByCredentialDefinitionId(
          validator.context,
          holderCredentialDefinitionId,
        )
        credentialDefinitionRecord.setTag('relatedJsonSchemaCredentialId', vtjsc.id)
        await credentialDefinitionRepository.update(validator.context, credentialDefinitionRecord)
      }, SETUP_TIMEOUT_MS)

      it(
        'requests an offered credential while the issuer holds the ISSUER Participant, and refuses once the chain revokes it',
        async () => {
          const offer = await controller.createCredentialOffer(holderOfferBody() as never)
          const offered = await receiveOffer(offer.invitation)

          const requested = await holderCredentials.acceptCredentialOffer(offered.id)
          expect(requested.state).toBe(DidCommCredentialState.RequestSent)

          // The holder needs the credential in its store for the presentation below.
          await untilState(offer.credentialExchangeId, DidCommCredentialState.RequestReceived)
          await controller.acceptCredentialRequest(offer.credentialExchangeId)
          await until(async () =>
            (await applicant.didcomm.credentials.getById(offered.id)).state ===
            DidCommCredentialState.CredentialReceived
              ? offered.id
              : undefined,
          )
          await holderCredentials.acceptCredential(offered.id)

          // This offer travels while the issuer is still authorized, so only the revocation below
          // can refuse it.
          const pending = await controller.createCredentialOffer(holderOfferBody() as never)
          refusedOfferId = (await receiveOffer(pending.invitation)).id

          await chainA.revokeParticipant(corpPolicyAddress, issuerParticipantId)
          await untilHolderParticipantCount(ParticipantRole.Issuer, 0)

          const error = await holderCredentials.acceptCredentialOffer(refusedOfferId).catch(caught => caught)

          expect(error).toBeInstanceOf(AdminApiError)
          expect(error.code).toBe('PEER_NOT_AUTHORIZED')
          expect(error.status).toBe(409)
          expect((await applicant.didcomm.credentials.getById(refusedOfferId)).state).toBe(
            DidCommCredentialState.OfferReceived,
          )
        },
        SETUP_TIMEOUT_MS,
      )

      it(
        'presents while the verifier holds the VERIFIER Participant, and refuses once the chain revokes it',
        async () => {
          const verifier = await chainA.startParticipantOp(corpPolicyAddress, {
            role: PARTICIPANT_ROLE_VERIFIER,
            validatorParticipantId: holderRootParticipantId,
            did: validatorDid,
          })
          await seederChain.setParticipantOPToValidated({
            id: verifier.participantId,
            opSummaryDigest: 'sha384-holderverifier',
          })
          await untilHolderParticipantCount(ParticipantRole.Verifier, 1)

          const requestBody = {
            requestedCredentials: [{ credentialDefinitionId: holderCredentialDefinitionId }],
          }
          const request = await presentations.createPresentationRequest(requestBody as never)
          const received = await receiveRequest(request.invitation)

          const presented = await holderPresentations.acceptPresentationRequest(received.id)
          expect(presented.state).toBe(DidCommProofState.PresentationSent)

          const pending = await presentations.createPresentationRequest(requestBody as never)
          refusedRequestId = (await receiveRequest(pending.invitation)).id

          await chainA.revokeParticipant(corpPolicyAddress, verifier.participantId)
          await untilHolderParticipantCount(ParticipantRole.Verifier, 0)

          const error = await holderPresentations
            .acceptPresentationRequest(refusedRequestId)
            .catch(caught => caught)

          expect(error).toBeInstanceOf(AdminApiError)
          expect(error.code).toBe('PEER_NOT_AUTHORIZED')
          expect(error.status).toBe(409)
          expect((await applicant.didcomm.proofs.getById(refusedRequestId)).state).toBe(
            DidCommProofState.RequestReceived,
          )
        },
        SETUP_TIMEOUT_MS,
      )

      it(
        'refuses a request from a verifier that connected with a did:peer DID',
        async () => {
          const { message } = await validator.didcomm.proofs.createRequest({
            protocolVersion: 'v2',
            proofFormats: {
              anoncreds: {
                name: 'proof-request',
                version: '1.0',
                requested_attributes: {
                  HolderTrustCredential: {
                    names: ['name'],
                    restrictions: [{ cred_def_id: holderCredentialDefinitionId }],
                  },
                },
              },
            },
          })
          // No `ourDid`, so the invitation carries a did:peer instead of the public DID.
          const { outOfBandInvitation } = await validator.didcomm.oob.createInvitation({
            label: validator.label,
            messages: [message],
            didCommVersion: 'v2',
          })
          const received = await receiveRequest(
            outOfBandInvitation.v2Invitation?.toJSON() ?? outOfBandInvitation.toJSON(),
          )

          const connection = await applicant.didcomm.connections.getById(received.connectionId as string)
          expect(connection.theirDid?.startsWith('did:peer:')).toBe(true)

          const error = await holderPresentations
            .acceptPresentationRequest(received.id)
            .catch(caught => caught)

          expect(error).toBeInstanceOf(AdminApiError)
          expect(error.code).toBe('PEER_NOT_AUTHORIZED')
          expect(error.status).toBe(409)
          expect(error.message).toContain('Supported methods: web, webvh')
          expect((await applicant.didcomm.proofs.getById(received.id)).state).toBe(
            DidCommProofState.RequestReceived,
          )
        },
        SETUP_TIMEOUT_MS,
      )

      it(
        'answers RESOLVER_UNAVAILABLE on both accept methods while the indexer is unreachable',
        async () => {
          const reachable = applicant.indexer
          applicant.indexer = new VeranaIndexerService({ baseUrl: 'http://127.0.0.1:1', logger })

          try {
            const offerError = await holderCredentials
              .acceptCredentialOffer(refusedOfferId)
              .catch(caught => caught)
            expect(offerError).toBeInstanceOf(AdminApiError)
            expect(offerError.code).toBe('RESOLVER_UNAVAILABLE')
            expect(offerError.status).toBe(503)

            const requestError = await holderPresentations
              .acceptPresentationRequest(refusedRequestId)
              .catch(caught => caught)
            expect(requestError).toBeInstanceOf(AdminApiError)
            expect(requestError.code).toBe('RESOLVER_UNAVAILABLE')
            expect(requestError.status).toBe(503)

            expect((await applicant.didcomm.credentials.getById(refusedOfferId)).state).toBe(
              DidCommCredentialState.OfferReceived,
            )
            expect((await applicant.didcomm.proofs.getById(refusedRequestId)).state).toBe(
              DidCommProofState.RequestReceived,
            )
          } finally {
            applicant.indexer = reachable
          }
        },
        SETUP_TIMEOUT_MS,
      )
    })
  })
})
