import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { ConsoleLogger, DidRepository, LogLevel } from '@credo-ts/core'
import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { computeSchemaDigest } from '@verana-labs/vs-agent-model'
import {
  createJsc,
  EcsBootstrapService,
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
  type SelfTrDefaults,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  PARTICIPANT_ROLE_ISSUER,
  VeranaTestChain,
} from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import {
  COOLUSER_MNEMONIC,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from '../../../../packages/agent-sdk/tests/e2e/helpers'
import { startAgent } from '../__mocks__'
import { FakeDidResolver } from '../__mocks__/fakeDidResolver'
import {
  isVtFlowStateChangedEvent,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  waitForEvent,
  type SubjectMessage,
} from '../helpers'

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

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
const selfTrDefaults: SelfTrDefaults = {
  agentLabel: 'Applicant',
  serviceLogoUri: 'https://cdn.example/logo.png',
  serviceLogoDigestSri: 'sha384-logo',
  serviceType: 'ECommerce',
  serviceDescription: 'lifecycle applicant service',
  serviceMinimumAgeRequired: 18,
  serviceTermsAndConditions: 'https://cdn.example/terms',
  serviceTermsAndConditionsDigestSri: 'sha384-terms',
  servicePrivacyPolicy: 'https://cdn.example/privacy',
  servicePrivacyPolicyDigestSri: 'sha384-privacy',
  orgRegistryId: 'REG-1',
  orgRegistryUri: 'https://registry.example',
  orgAddress: '1 Demo Street',
  orgOrganizationKind: 'PUBLIC',
  orgCountryCode: 'US',
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

      const chainParticipant = await seederChain.getParticipant(holderOp.id)
      expect(chainParticipant).toBeDefined()

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
    'issues the Service credential to a delegated child via direct issuance',
    async () => {
      await seederChain.cancelParticipantOPLastRequest(serviceOpId)
      const opP = await chainA.createFundedOperator()
      const parentServiceOp = await chainA.startParticipantOp(corpPolicyAddress, {
        role: PARTICIPANT_ROLE_ISSUER,
        validatorParticipantId: serviceRootId,
        did: applicant.did!,
        vsOperator: opP.address,
        vsOperatorAuthzMsgTypes: [PP_SESSION],
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

      let childOrchestrator: VtFlowOrchestrator | undefined
      const child = await startAgent({
        label: 'Child',
        domain: 'child',
        didcommVersions: ['v1', 'v2'],
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
      childOrchestrator = new VtFlowOrchestrator(child, {
        publicApiBaseUrl: child.publicApiBaseUrl,
      })

      const bootstrap = new EcsBootstrapService(
        child,
        indexer,
        { mode: 'delegated', delegatedParentVsDid: applicant.did!, verifyPeer: async () => true },
        logger,
      )
      await bootstrap.run()

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

      // A second run must leave it attached, which is what proves the two passes agree.
      await reconcileVtjscPublications(validator, indexer, ownCorporationId)
      expect(await serviceIds()).toContain(serviceId)
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
        selfTrDefaults,
        jscUrl,
        applicantIssuerParticipantId,
      )

      const linkedVpServiceId = `${applicant.did}#vpr-schemas-service-vtc-vp`
      expect(await vtcEntries()).toContain(jscUrl)
      expect(await serviceIds()).toContain(linkedVpServiceId)

      await chainA.revokeParticipant(corpPolicyAddress, applicantIssuerParticipantId)
      await until(async () => {
        const p = await seederChain.getParticipant(applicantIssuerParticipantId)
        return p?.revoked ? true : undefined
      })

      await removeSelfIssuedEcsCredentialsIfIssuerRevoked(
        applicant,
        String(applicantIssuerParticipantId),
        selfTrDefaults,
      )

      expect(await vtcEntries()).not.toContain(jscUrl)
      expect(await serviceIds()).not.toContain(linkedVpServiceId)
      // back in store, detached: this agent already holds the credential a validator issued to it
      expect(await vtcEntries()).toContain(`${baseUrl}/vt/schemas-example-service-jsc.json`)
    },
    SETUP_TIMEOUT_MS,
  )
})
