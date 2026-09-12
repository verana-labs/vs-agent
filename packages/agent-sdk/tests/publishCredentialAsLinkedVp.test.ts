import { VtFlowRole } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { createVtc } from '../src/utils'
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
