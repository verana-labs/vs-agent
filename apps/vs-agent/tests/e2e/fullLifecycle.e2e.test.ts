import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { VtFlowRole, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { computeSchemaDigest } from '@verana-labs/vs-agent-model'
import {
  createJsc,
  EcsBootstrapService,
  getEcsSchemas,
  ParticipantRole,
  ParticipantState,
  reconcileVtFlowRecordsOnCancel,
  VeranaChainService,
  VeranaIndexerService,
  VtFlowOrchestrator,
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

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

const RUN_ID = String(Date.now())
const PP_VALIDATE = '/verana.pp.v1.MsgSetParticipantOPToValidated'
const PP_SESSION = '/verana.pp.v1.MsgCreateOrUpdateParticipantSession'

const ecsSchema = (title: string) =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description: `lifecycle ${title}`,
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  })

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn().catch(() => undefined)
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 2_000))
  }
  throw new Error('condition did not resolve in time')
}

describeE2E('v4 full lifecycle on a live chain and indexer', () => {
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
  let orgSchemaId: number
  let serviceSchemaId: number
  let validatorParticipantId: number
  let serviceOpId: number
  let serviceRootId: number
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
      jsonSchemaRef: `vpr:verana:${validatorChain.getChainId}/cs/v1/js/${orgSchemaId}`,
      precomputedDigestSRI: await computeSchemaDigest(JSON.parse(ecsSchema('OrganizationCredential'))),
    })

    applicant = await startAgent({
      label: 'Applicant',
      domain: 'applicant',
      didcommVersions: ['v1', 'v2'],
      veranaChain: seederChain,
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
      indexer,
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
      const flowsService = new VtFlowsService({ getAgent: async () => validator } as never)

      const applicantCompleted = waitForEvent(
        applicantEvents,
        isVtFlowStateChangedEvent(VtFlowState.Completed),
      )
      const validatorFlow = (await flowsService.listFlows({ role: VtFlowRole.Validator }))[0]
      const validated = await new VtFlowOrchestrator(validator, {
        indexer,
        publicApiBaseUrl: validator.publicApiBaseUrl,
      }).validateAndOfferCredential({
        vtFlowRecordId: validatorFlow.id,
        credentialSchemaId: String(orgSchemaId),
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
        jsonSchemaRef: `vpr:verana:${seederChain.getChainId}/cs/v1/js/${serviceSchemaId}`,
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

      // eslint-disable-next-line prefer-const
      let childOrchestrator: VtFlowOrchestrator | undefined
      const child = await startAgent({
        label: 'Child',
        domain: 'child',
        didcommVersions: ['v1', 'v2'],
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
        indexer,
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
})
