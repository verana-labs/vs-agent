import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { VtFlowApi, VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { Subject } from 'rxjs'
import { describe, it, beforeEach, afterEach, vi, expect, beforeAll, afterAll } from 'vitest'

import { type BaseAgentModules, type VsAgent } from '../src/agent'
import { VeranaChainService } from '../src/blockchain'
import { type SubjectMessage, SubjectInboundTransport, SubjectOutboundTransport } from '../src/utils/testing'
import { isVtFlowStateChangedEvent, waitForEvent } from '../src/utils/testing/helpers'
import { VtFlowOrchestrator } from '../src/vtFlow'

import { startAgent, FakeDidResolver } from './__mocks__'
import { getEcsSchemas } from '../src/utils'

export function mockWitnessFetch() {
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

const ENV = {
  VERANA_RPC_ENDPOINT_URL: 'https://rpc.devnet.verana.network',
  VERANA_INDEXER_BASE_URL: 'https://idx.devnet.verana.network',
  CHAIN_ID: 'vna-devnet-1',
  TEST_MNEMONIC: 'camp provide noodle speed wheel narrow soul fix jeans apple wine will',
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

describe('VSA-VTI-FLOW-VP-NEW (devnet E2E)', () => {
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

  beforeAll(async () => {
    restoreFetch = mockWitnessFetch()
    const logger = new ConsoleLogger(LogLevel.Debug)
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
      autoInitialize: false,
    })
    applicantAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(applicantMessages))
    applicantAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    applicantAgent.dids.config.addResolver(sharedResolver)
    await applicantAgent.initialize()
    sharedResolver.registerAgent(applicantAgent)

    validatorAgent = await startAgent({
      label: 'Validator Test',
      domain: 'validator',
      veranaChain: validatorChain,
      autoInitialize: false,
    })
    validatorAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(validatorMessages))
    validatorAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    validatorAgent.dids.config.addResolver(sharedResolver)
    await validatorAgent.initialize()
    sharedResolver.registerAgent(validatorAgent)

    applicantEvents = vi.spyOn(applicantAgent.events, 'emit')
    validatorEvents = vi.spyOn(validatorAgent.events, 'emit')

    // Create credential on Verana Chain for testing
    await validatorChain.grantOperatorAuthorization({
      grantee: validatorChain.address,
      msgTypes: MSG_TYPES,
    })

    await validatorChain.createTrustRegistry({
      did: validatorAgent.did!,
      aka: validatorAgent.did,
      language: 'en',
      docUrl: 'https://example.com/validator-doc',
      docDigestSri: 'sha256-+5HXWmu0MHh6YbCuxeN09YADDyh44WE+q1ymMQ97u5o=',
    })

    const registries = await validatorChain.listTrustRegistries({
      corporation: validatorChain.address,
    })

    trustRegistryId = registries.find(
      r => r.did === validatorAgent.did && !r.archived
    )?.id
    console.log('Trust Registry:', JSON.stringify(trustRegistryId, null, 2))

    const schemas = getEcsSchemas(`https://${validatorAgent.did?.split(':')[2]}`)
    await validatorChain.createCredentialSchema({
      trId: trustRegistryId!,
      jsonSchema: schemas['ecs-org'],
      issuerOnboardingMode: 2, // ECOSYSTEM_VALIDATION_PROCESS
    })
    const credSchemas = await validatorChain.listCredentialSchemas({
      trId: trustRegistryId!,
      issuerOnboardingMode: 2,
    })
    credentialSchemaId = credSchemas[0]?.id
    console.log('Credential Schema:', JSON.stringify(credentialSchemaId, null, 2))

    await validatorChain.createRootPermission({
      schemaId: credentialSchemaId!,
      did: validatorAgent.did!,
      effectiveFrom: new Date(Date.now() + 10 * 1000)
    })

    const permissions = await validatorChain.findPermissionsWithDID({ 
      did: validatorAgent.did!,
      type: 2,
      schemaId: credentialSchemaId!
    })
    validatorPermId = permissions[0]?.id
    console.log('Permission:', JSON.stringify(validatorPermId, null, 2))
  }, 60_000)

  afterAll(async () => {
    restoreFetch?.()
    vi.restoreAllMocks()
    await applicantAgent?.shutdown()
    await validatorAgent?.shutdown()
    await validatorChain.archiveTrustRegistry({
      trId: trustRegistryId!,
      archive: true,
    })
  })
  it('should run setup', async () => {
    expect(true).toBe(true)
  })
  it('happy path: VR → CRED_OFFER → CRED_ACCEPT → Completed', async () => {
    const applicantOrchestrator = new VtFlowOrchestrator(applicantAgent)
    const validatorOrchestrator = new VtFlowOrchestrator(validatorAgent)
    if (!validatorPermId || !credentialSchemaId) throw new Error('Missing setup data')

    const applicantRecord = await applicantOrchestrator.startValidationProcess({ validatorPermId })
    expect(applicantRecord.state).toBe(VtFlowState.VrSent)

    const validatorVrEvent = await waitForEvent(
      validatorEvents,
      isVtFlowStateChangedEvent(VtFlowState.AwaitingVr),
    )
    const validatorRecordId = validatorVrEvent.payload.vtFlowRecordId

    await validatorOrchestrator.validateAndOfferCredential({
      vtFlowRecordId: validatorRecordId,
      credentialSchemaId: credentialSchemaId.toString(),
    })

    const applicantCredOfferEvent = await waitForEvent(
      applicantEvents,
      isVtFlowStateChangedEvent(VtFlowState.CredOffered),
    )
    const applicantRecordId = applicantCredOfferEvent.payload.vtFlowRecordId
    await applicantOrchestrator.acceptCredential({ vtFlowRecordId: applicantRecordId })
    await waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Completed))

    const applicantVtFlowApi = applicantAgent.dependencyManager.resolve(VtFlowApi)
    const validatorVtFlowApi = validatorAgent.dependencyManager.resolve(VtFlowApi)

    const finalApplicantRecord = await applicantVtFlowApi.findById(applicantRecordId)
    const finalValidatorRecord = await validatorVtFlowApi.findById(validatorRecordId)

    expect(finalApplicantRecord?.state).toBe(VtFlowState.Completed)
    expect(finalValidatorRecord?.state).toBe(VtFlowState.Completed)
  }, 120_000)
})
