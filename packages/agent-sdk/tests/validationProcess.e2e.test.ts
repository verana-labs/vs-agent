import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { DidCommConnectionEventTypes, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { VtFlowApi, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { Subject } from 'rxjs'
import { describe, it, vi, expect, beforeAll, afterAll } from 'vitest'

import { type BaseAgentModules, type VsAgent } from '../src/agent'
import { IndexerWebSocketService, ValidationState, VeranaChainService } from '../src/blockchain'
import { ISSUER_PERMISSION_TYPE } from '../src/types'
import { getEcsSchemas } from '../src/utils'
import { type SubjectMessage, SubjectInboundTransport, SubjectOutboundTransport } from '../src/utils/testing'
import { isVtFlowStateChangedEvent, waitForEvent } from '../src/utils/testing/helpers'
import { VtFlowOrchestrator } from '../src/vtFlow'

import { startAgent, FakeDidResolver } from './__mocks__'

function mockWitnessFetch() {
  const original = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('did-witness.json')) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return original(input, init)
  })
  return () => spy.mockRestore()
}

async function retryUntilEffective<T>(fn: () => Promise<T>, attempts = 6, delayMs = 3_000): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (!msg.includes('perm not yet effective')) throw e
      lastErr = e
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

const ENV = {
  VERANA_RPC_ENDPOINT_URL: 'https://rpc.devnet.verana.network',
  VERANA_INDEXER_BASE_URL: 'https://idx.devnet.verana.network',
  CHAIN_ID: 'vna-devnet-1',
  TEST_MNEMONIC: process.env.TEST_MNEMONIC ?? '', // Provide a mnemonic with funds for testing
}
const MSG_TYPES = [
  '/verana.de.v1.MsgGrantOperatorAuthorization',
  '/verana.tr.v1.MsgCreateTrustRegistry',
  '/verana.tr.v1.MsgArchiveTrustRegistry',
  '/verana.tr.v1.MsgAddGovernanceFrameworkDocument',
  '/verana.cs.v1.MsgCreateCredentialSchema',
  '/verana.cs.v1.MsgArchiveCredentialSchema',
  '/verana.perm.v1.MsgStartPermissionVP',
  '/verana.perm.v1.MsgSetPermissionVPToValidated',
  '/verana.perm.v1.MsgCreateRootPermission',
  '/verana.perm.v1.MsgSlashPermissionTrustDeposit',
  '/verana.perm.v1.MsgRepayPermissionSlashedTrustDeposit',
  '/verana.perm.v1.MsgSelfCreatePermission',
]

const hasMnemonic = !!process.env.TEST_MNEMONIC
describe.skipIf(!hasMnemonic)('VSA-VTI-FLOW-VP-NEW (devnet E2E)', () => {
  let applicantAgent: VsAgent<BaseAgentModules>
  let validatorAgent: VsAgent<BaseAgentModules>
  const applicantMessages = new Subject<SubjectMessage>()
  const validatorMessages = new Subject<SubjectMessage>()
  let applicantChain: VeranaChainService
  let validatorChain: VeranaChainService
  const subjectMap = {
    'rxjs:applicant': applicantMessages,
    'rxjs:validator': validatorMessages,
  }
  let applicantEvents: ReturnType<typeof vi.spyOn>
  let validatorEvents: ReturnType<typeof vi.spyOn>
  let restoreFetch: () => void
  let trustRegistryId: number | undefined
  let credentialSchemaId: number | undefined
  let validatorPermId: number | undefined
  let applicantIndexerWs: IndexerWebSocketService | undefined
  let validatorIndexerWs: IndexerWebSocketService | undefined

  beforeAll(async () => {
    restoreFetch = mockWitnessFetch()
    const logger = new ConsoleLogger(LogLevel.Off)
    const sharedResolver = new FakeDidResolver()

    applicantChain = new VeranaChainService({
      rpcUrl: ENV.VERANA_RPC_ENDPOINT_URL,
      mnemonic: ENV.TEST_MNEMONIC,
      chainId: ENV.CHAIN_ID,
      logger,
    })
    await applicantChain.start()

    validatorChain = new VeranaChainService({
      rpcUrl: ENV.VERANA_RPC_ENDPOINT_URL,
      mnemonic: ENV.TEST_MNEMONIC,
      chainId: ENV.CHAIN_ID,
      logger,
    })
    await validatorChain.start()

    applicantAgent = await startAgent({
      label: 'Applicant Test',
      domain: 'applicant',
      veranaChain: applicantChain,
      vtFlowOptions: {
        autoAcceptCredentialOffer: true,
        verifyCredential: async () => true,
      },
      logger,
    })
    applicantAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(applicantMessages))
    applicantAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    applicantAgent.dids.config.resolvers.unshift(sharedResolver)
    await applicantAgent.initialize()
    await sharedResolver.registerAgent(applicantAgent)

    validatorAgent = await startAgent({
      label: 'Validator Test',
      domain: 'validator',
      veranaChain: validatorChain,
      vtFlowOptions: { autoIssueCredentialOnRequest: true },
      logger,
    })
    validatorAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(validatorMessages))
    validatorAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    validatorAgent.dids.config.resolvers.unshift(sharedResolver)
    await validatorAgent.initialize()
    await sharedResolver.registerAgent(validatorAgent)

    applicantEvents = vi.spyOn(applicantAgent.events, 'emit')
    validatorEvents = vi.spyOn(validatorAgent.events, 'emit')

    // Auto-accept connection requests for testing
    applicantAgent.events.on(DidCommConnectionEventTypes.DidCommConnectionStateChanged, async (e: any) => {
      if (e.payload?.connectionRecord?.state === DidCommDidExchangeState.RequestReceived) {
        await applicantAgent.didcomm.connections.acceptRequest(e.payload?.connectionRecord?.id)
      }
    })
    validatorAgent.events.on(DidCommConnectionEventTypes.DidCommConnectionStateChanged, async (e: any) => {
      if (e.payload?.connectionRecord?.state === DidCommDidExchangeState.RequestReceived) {
        await validatorAgent.didcomm.connections.acceptRequest(e.payload?.connectionRecord?.id)
      }
    })

    applicantIndexerWs = new IndexerWebSocketService({
      indexerUrl: ENV.VERANA_INDEXER_BASE_URL,
      agent: applicantAgent,
    })
    await applicantIndexerWs.start()
    validatorIndexerWs = new IndexerWebSocketService({
      indexerUrl: ENV.VERANA_INDEXER_BASE_URL,
      agent: validatorAgent,
    })
    await validatorIndexerWs.start()

    try {
      await validatorChain.revokeOperatorAuthorization({ grantee: validatorChain.address })
    } catch {
      // ignore: no prior auth
    }

    // Create credential on Verana Chain for testing
    await validatorChain.grantOperatorAuthorization({
      grantee: validatorChain.address,
      msgTypes: MSG_TYPES,
    })

    const trCreated = await validatorChain.createTrustRegistry({
      did: validatorAgent.did!,
      aka: validatorAgent.did,
      language: 'en',
      docUrl: 'https://example.com/validator-doc',
      docDigestSri: 'sha256-+5HXWmu0MHh6YbCuxeN09YADDyh44WE+q1ymMQ97u5o=',
    })
    trustRegistryId = trCreated.trustRegistryId

    const schemas = getEcsSchemas(`https://${validatorAgent.did?.split(':')[2]}`)
    const csCreated = await validatorChain.createCredentialSchema({
      trId: trustRegistryId!,
      jsonSchema: schemas['ecs-org'],
      issuerOnboardingMode: 2, // ECOSYSTEM_VALIDATION_PROCESS
    })
    credentialSchemaId = csCreated.schemaId

    await validatorChain.createRootPermission({
      schemaId: credentialSchemaId!,
      did: validatorAgent.did!,
      effectiveFrom: new Date(Date.now() + 5_000),
    })

    const permissions = await validatorChain.findPermissionsWithDID({
      did: validatorAgent.did!,
      type: 2,
      schemaId: credentialSchemaId!,
    })
    validatorPermId = permissions[0]?.id
  }, 60_000)

  afterAll(async () => {
    restoreFetch?.()
    vi.restoreAllMocks()
    applicantIndexerWs?.stop()
    validatorIndexerWs?.stop()
    await applicantAgent?.shutdown()
    await validatorAgent?.shutdown()
    await validatorChain.archiveTrustRegistry({
      trId: trustRegistryId!,
      archive: true,
    })
  })

  it('happy path: VR → CRED_OFFER → CRED_ACCEPT → Completed → LinkedVP', async () => {
    if (!validatorPermId || !credentialSchemaId) throw new Error('Missing setup data')

    const applicantPublicApiBaseUrl = `https://${applicantAgent.did!.split(':')[2]}`
    const validatorPublicApiBaseUrl = `https://${validatorAgent.did!.split(':')[2]}`
    const applicantOrchestrator = new VtFlowOrchestrator(applicantAgent, {
      publicApiBaseUrl: applicantPublicApiBaseUrl,
    })
    const validatorOrchestrator = new VtFlowOrchestrator(validatorAgent, {
      publicApiBaseUrl: validatorPublicApiBaseUrl,
    })

    const { permissionId: applicantPermId } = await retryUntilEffective(() =>
      applicantChain.startPermissionVP({
        type: ISSUER_PERMISSION_TYPE,
        validatorPermId: validatorPermId!,
        did: applicantAgent.did!,
      }),
    )
    expect(applicantPermId).toBeGreaterThan(0)
    await waitForEvent(applicantEvents, isVtFlowStateChangedEvent(VtFlowState.VrSent))

    const validatorVrEvent = await waitForEvent(
      validatorEvents,
      isVtFlowStateChangedEvent(VtFlowState.AwaitingVr),
    )
    const validatorRecordId = validatorVrEvent.payload.vtFlowRecordId

    await validatorOrchestrator.validateAndOfferCredential({
      vtFlowRecordId: validatorRecordId,
      credentialSchemaId: credentialSchemaId.toString(),
    })

    await waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Completed))
    const applicantCompletedEvent = await waitForEvent(
      applicantEvents,
      isVtFlowStateChangedEvent(VtFlowState.Completed),
    )
    const applicantRecordId = applicantCompletedEvent.payload.vtFlowRecordId

    const applicantVtFlowApi = applicantAgent.dependencyManager.resolve(VtFlowApi)
    const validatorVtFlowApi = validatorAgent.dependencyManager.resolve(VtFlowApi)

    const finalApplicantRecord = await applicantVtFlowApi.findById(applicantRecordId)
    const finalValidatorRecord = await validatorVtFlowApi.findById(validatorRecordId)

    expect(finalApplicantRecord?.state).toBe(VtFlowState.Completed)
    expect(finalValidatorRecord?.state).toBe(VtFlowState.Completed)

    await applicantOrchestrator.publishCredentialAsLinkedVp(applicantRecordId)
    const [applicantDidRecord] = await applicantAgent.dids.getCreatedDids({ did: applicantAgent.did! })
    const linkedVps =
      applicantDidRecord?.didDocument?.service?.filter(s => s.type === 'LinkedVerifiablePresentation') ?? []
    expect(linkedVps.length).toBeGreaterThan(0)
    expect(
      linkedVps.some(
        vp =>
          vp.id === `${applicantAgent.did}#whois` &&
          vp.serviceEndpoint === 'https://applicant/vt/ecs-service-c-vp.json',
      ),
    ).toBe(true)

    const onChainPerm = await applicantChain.getPermission(applicantPermId)
    expect(onChainPerm?.vpState).toBe(ValidationState.VALIDATED)
  }, 120_000)
})
