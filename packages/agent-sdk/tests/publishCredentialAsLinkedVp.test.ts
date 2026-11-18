import { RecordNotFoundError } from '@credo-ts/core'
import {
  VtFlowErrorCode,
  VtFlowRecord,
  VtFlowRole,
  VtFlowService,
  VtFlowState,
  VtFlowVariant,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { removeHolderTrustCredentialIfRevoked } from '../src/blockchain/handlers/stateMutations'
import { createVtc, findExchangeCredentialId } from '../src/utils'
import { VtFlowOrchestrator } from '../src/vtFlow/VtFlowOrchestrator'

vi.mock('../src/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils')>()),
  createVtc: vi.fn(async () => ({})),
}))

const BASE_URL = 'https://child.example'

function makeOrchestrator(ecsSchemaKey?: string) {
  const record = {
    id: 'flow-1',
    role: VtFlowRole.Applicant,
    credentialExchangeRecordId: 'cx-1',
    ecsSchemaKey,
  }
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'VerifiableTrustCredential'],
    issuer: 'did:web:parent.example',
    issuanceDate: '2026-01-01T00:00:00Z',
    credentialSubject: { id: 'did:web:child.example' },
    credentialSchema: {
      id: 'https://ecosystem.example/vt/schemas-12-jsc.json',
      type: 'JsonSchemaCredential',
    },
    proof: {
      type: 'Ed25519Signature2020',
      created: '2026-01-01T00:00:00Z',
      verificationMethod: 'did:web:parent.example#key-1',
      proofPurpose: 'assertionMethod',
      proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKodkEzM5HZs2GW1Bv7',
    },
  }
  const getCredentialSchema = vi.fn(async () => {
    throw new Error('publication must not reach the indexer')
  })
  const agent = {
    did: 'did:web:child.example',
    config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    dependencyManager: { resolve: () => ({ findById: vi.fn(async () => record) }) },
    didcomm: {
      credentials: {
        getFormatData: vi.fn(async () => ({ credential: { dataIntegrity: { credential } } })),
      },
    },
    indexer: { getCredentialSchema },
  }
  return {
    orchestrator: new VtFlowOrchestrator(agent as never, { publicApiBaseUrl: BASE_URL }),
    getCredentialSchema,
  }
}

describe('VtFlowOrchestrator.publishCredentialAsLinkedVp', () => {
  it('publishes under the ECS key the verification stored, like the self-issued path', async () => {
    const { orchestrator, getCredentialSchema } = makeOrchestrator('ecs-service')

    await orchestrator.publishCredentialAsLinkedVp('flow-1')

    expect(createVtc).toHaveBeenCalledWith(expect.anything(), BASE_URL, 'service', expect.anything())
    expect(getCredentialSchema).not.toHaveBeenCalled()
  })

  it('falls back to the schema id of the credential when the record carries no ECS key', async () => {
    const { orchestrator } = makeOrchestrator()

    await orchestrator.publishCredentialAsLinkedVp('flow-1')

    expect(createVtc).toHaveBeenCalledWith(expect.anything(), BASE_URL, '12', expect.anything())
  })
})

const APPLICANT_DID = 'did:web:child.example'
const CREDENTIAL_ID = 'https://parent.example/credentials/1'
const JSC_ID = 'https://ecosystem.example/vt/schemas-12-jsc.json'
const SERVICE_ID = `${APPLICANT_DID}#vpr-schemas-12-vtc-vp`
const PARTICIPANT_ID = '12'
const HOLDER_ROLE = 6

const RECEIVED_CREDENTIAL = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: CREDENTIAL_ID,
  type: ['VerifiableCredential', 'VerifiableTrustCredential'],
  issuer: 'did:web:parent.example',
  issuanceDate: '2026-01-01T00:00:00Z',
  credentialSubject: { id: APPLICANT_DID },
  credentialSchema: { id: JSC_ID, type: 'JsonSchemaCredential' },
  proof: {
    type: 'Ed25519Signature2020',
    created: '2026-01-01T00:00:00Z',
    verificationMethod: 'did:web:parent.example#key-1',
    proofPurpose: 'assertionMethod',
    proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKodkEzM5HZs2GW1Bv7',
  },
}

const RENEWAL_PARAMS = {
  connectionId: 'conn-2',
  participantSessionId: 'sess-1',
  applicantParticipantId: PARTICIPANT_ID,
  agentParticipantId: '0',
  walletAgentParticipantId: '0',
}

function makeFlow() {
  const record = new VtFlowRecord({
    threadId: 'thread-1',
    participantSessionId: 'sess-1',
    connectionId: 'conn-1',
    role: VtFlowRole.Applicant,
    state: VtFlowState.Completed,
    variant: VtFlowVariant.OnboardingProcess,
    agentParticipantId: '0',
    walletAgentParticipantId: '0',
    applicantParticipantId: PARTICIPANT_ID,
    credentialExchangeRecordId: 'cx-1',
  })
  const repository = {
    getById: async () => record,
    findById: async () => record,
    findByThreadId: async () => record,
    findByParticipantSessionId: async () => record,
    findByQuery: async () => [record],
    update: vi.fn(),
    save: vi.fn(),
  }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = new VtFlowService(
    repository as never,
    { emit: vi.fn() } as never,
    logger as never,
    {} as never,
  )

  const metadataStore: Record<string, Record<string, unknown>> = {
    '_vt/vtc': {
      [JSC_ID]: {
        credential: { id: CREDENTIAL_ID },
        verifiablePresentation: { id: `${BASE_URL}/vt/schemas-12-vtc-vp.json` },
        didDocumentServiceId: SERVICE_ID,
      },
    },
  }
  const didRecord = {
    did: APPLICANT_DID,
    didDocument: { id: APPLICANT_DID, service: [{ id: SERVICE_ID }] },
    metadata: {
      get: (key: string) => metadataStore[key],
      set: (key: string, value: Record<string, unknown>) => {
        metadataStore[key] = value
      },
    },
  }

  const context = {
    dependencyManager: {
      resolve: (token: unknown) => (token === VtFlowService ? service : { update: vi.fn() }),
    },
  }
  const getFormatData = vi.fn(async () => ({
    credential: { dataIntegrity: { credential: RECEIVED_CREDENTIAL } },
  }))
  const deleteStoredById = vi.fn()
  const agent = {
    did: APPLICANT_DID,
    publicApiBaseUrl: BASE_URL,
    config: { logger },
    context,
    indexer: {
      findParticipant: vi.fn(async () => ({ role: HOLDER_ROLE, did: APPLICANT_DID })),
      getCredentialSchema: vi.fn(async () => {
        throw new Error('publication must not reach the indexer')
      }),
    },
    dependencyManager: {
      resolve: () => ({
        findById: (id: string) => service.findById(context as never, id),
        setCredentialId: (id: string, credentialId: string) =>
          service.setCredentialId(context as never, id, credentialId),
      }),
    },
    didcomm: { credentials: { getFormatData } },
    dids: { getCreatedDids: async () => [didRecord], update: vi.fn() },
    w3cV2Credentials: { getAll: async () => [], deleteById: vi.fn() },
    w3cCredentials: {
      getAll: async () => [{ id: 'w3c-1', getTags: () => ({ givenId: CREDENTIAL_ID }) }],
      deleteById: deleteStoredById,
    },
  }

  return {
    agent,
    service,
    context,
    record,
    logger,
    metadataStore,
    didRecord,
    getFormatData,
    deleteStoredById,
    orchestrator: new VtFlowOrchestrator(agent as never, { publicApiBaseUrl: BASE_URL }),
  }
}

async function rejectRenewal(flow: ReturnType<typeof makeFlow>) {
  await flow.service.createOnboardingProcessRecord(flow.context as never, RENEWAL_PARAMS)
  expect(flow.record.state).toBe(VtFlowState.OrSent)
  expect(flow.record.credentialExchangeRecordId).toBe('cx-1')

  await flow.service.processReceiveProblemReport({
    message: {
      threadId: flow.record.threadId,
      description: { code: VtFlowErrorCode.ValidationRefused, en: 'the validator refused the renewal' },
    },
    agentContext: flow.context,
  } as never)
  expect(flow.record.state).toBe(VtFlowState.TerminatedByValidator)
}

function deleteExchange(flow: ReturnType<typeof makeFlow>) {
  flow.getFormatData.mockRejectedValue(
    new RecordNotFoundError('deleted', { recordType: 'DidCommCredentialExchangeRecord' }) as never,
  )
  flow.getFormatData.mockClear()
}

describe('a renewal that the validator rejects, after the exchange is deleted', () => {
  it('removes the linked VP and the stored credential with the id the publication kept', async () => {
    const flow = makeFlow()

    await flow.orchestrator.publishCredentialAsLinkedVp(flow.record.id)
    expect(flow.record.credentialId).toBe(CREDENTIAL_ID)

    await rejectRenewal(flow)

    await flow.service.detachCredentialExchange(flow.context as never, flow.record.id)
    deleteExchange(flow)

    await removeHolderTrustCredentialIfRevoked(flow.agent as never, PARTICIPANT_ID)

    expect(flow.getFormatData).not.toHaveBeenCalled()
    expect(flow.metadataStore['_vt/vtc'][JSC_ID]).toBeUndefined()
    expect(flow.didRecord.didDocument.service).toEqual([])
    expect(flow.deleteStoredById).toHaveBeenCalledWith('w3c-1')
  })

  it('removes them for an older record, with the id the delete reads before it removes the exchange', async () => {
    const flow = makeFlow()
    expect(flow.record.credentialId).toBeUndefined()

    await rejectRenewal(flow)

    const credentialId = await findExchangeCredentialId(flow.agent as never, 'cx-1')
    await flow.service.detachCredentialExchange(flow.context as never, flow.record.id, credentialId)
    expect(flow.record.credentialId).toBe(CREDENTIAL_ID)
    deleteExchange(flow)

    await removeHolderTrustCredentialIfRevoked(flow.agent as never, PARTICIPANT_ID)

    expect(flow.metadataStore['_vt/vtc'][JSC_ID]).toBeUndefined()
    expect(flow.didRecord.didDocument.service).toEqual([])
    expect(flow.deleteStoredById).toHaveBeenCalledWith('w3c-1')
  })

  it('warns and removes nothing when the record names a deleted exchange and no credential', async () => {
    const flow = makeFlow()

    await rejectRenewal(flow)
    deleteExchange(flow)

    await removeHolderTrustCredentialIfRevoked(flow.agent as never, PARTICIPANT_ID)

    expect(flow.logger.warn).toHaveBeenCalledWith(expect.stringContaining('cx-1'))
    expect(flow.logger.error).not.toHaveBeenCalled()
    expect(flow.metadataStore['_vt/vtc'][JSC_ID]).toBeDefined()
    expect(flow.deleteStoredById).not.toHaveBeenCalled()
  })
})
