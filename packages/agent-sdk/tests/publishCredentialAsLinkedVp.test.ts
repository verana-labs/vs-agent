import { VtFlowRole } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { createVtc } from '../src/utils'
import { VtFlowOrchestrator } from '../src/vtFlow/VtFlowOrchestrator'

vi.mock('../src/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/utils')>()),
  createVtc: vi.fn(async () => ({})),
}))

const BASE_URL = 'https://child.example'
const CHAIN_JSC_URL = 'https://ecosystem.example/vt/schemas-12-jsc.json'

function makeOrchestrator(options: { jsonSchema?: Record<string, unknown>; jscUrl?: string } = {}) {
  const record = { id: 'flow-1', role: VtFlowRole.Applicant, credentialExchangeRecordId: 'cx-1' }
  const jsonld = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'VerifiableTrustCredential'],
    issuer: 'did:web:parent.example',
    issuanceDate: '2026-01-01T00:00:00Z',
    credentialSubject: { id: 'did:web:child.example' },
    credentialSchema: { id: options.jscUrl ?? CHAIN_JSC_URL, type: 'JsonSchemaCredential' },
    proof: {
      type: 'Ed25519Signature2020',
      created: '2026-01-01T00:00:00Z',
      verificationMethod: 'did:web:parent.example#key-1',
      proofPurpose: 'assertionMethod',
      proofValue: 'z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNSARiKBk9czhSePTFehP8c3PGfb6a22gkfUKodkEzM5HZs2GW1Bv7',
    },
  }
  const getCredentialSchema = vi.fn(async () => {
    if (!options.jsonSchema) throw new Error('422 Unprocessable Entity')
    return { id: 12, json_schema: JSON.stringify(options.jsonSchema) }
  })
  const agent = {
    did: 'did:web:child.example',
    config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    dependencyManager: { resolve: () => ({ findById: vi.fn(async () => record) }) },
    didcomm: { credentials: { getFormatData: vi.fn(async () => ({ credential: { jsonld } })) } },
    indexer: { getCredentialSchema },
  }
  return {
    orchestrator: new VtFlowOrchestrator(agent as never, { publicApiBaseUrl: BASE_URL }),
    getCredentialSchema,
  }
}

describe('VtFlowOrchestrator.publishCredentialAsLinkedVp', () => {
  it('publishes a received ECS credential under its ECS key, like the self-issued path', async () => {
    const { orchestrator } = makeOrchestrator({ jsonSchema: { title: 'ServiceCredential' } })

    await orchestrator.publishCredentialAsLinkedVp('flow-1')

    expect(createVtc).toHaveBeenCalledWith(expect.anything(), BASE_URL, 'service', expect.anything())
  })

  it('keeps the chain schema id for a credential that is not an ECS one', async () => {
    const { orchestrator } = makeOrchestrator({ jsonSchema: { title: 'ConferenceBadge' } })

    await orchestrator.publishCredentialAsLinkedVp('flow-1')

    expect(createVtc).toHaveBeenCalledWith(expect.anything(), BASE_URL, '12', expect.anything())
  })

  it('does not ask the chain about a schema named by a slug and keeps the slug', async () => {
    const { orchestrator, getCredentialSchema } = makeOrchestrator({
      jscUrl: 'https://issuer.example/vt/schemas-example-service-jsc.json',
    })

    await orchestrator.publishCredentialAsLinkedVp('flow-1')

    expect(getCredentialSchema).not.toHaveBeenCalled()
    expect(createVtc).toHaveBeenCalledWith(expect.anything(), BASE_URL, 'example-service', expect.anything())
  })
})
