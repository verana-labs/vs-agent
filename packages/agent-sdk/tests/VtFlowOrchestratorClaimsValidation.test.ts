import { VtFlowRole, VtFlowState, VtFlowVariant } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { describe, expect, it, vi } from 'vitest'

import { VtFlowOrchestrator } from '../src/vtFlow/VtFlowOrchestrator'

const SCHEMA_JSON = JSON.stringify({
  $id: 'vpr:verana:vna-test-1:cs:5',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        countryCode: { type: 'string' },
      },
      required: ['id', 'name', 'countryCode'],
    },
  },
})

const holder = { id: 7, did: 'did:web:holder.example', corporation: 'corp1', validatorParticipantId: 1 }

function makeOrchestrator(claims: Record<string, unknown>) {
  const record = {
    id: 'rec-1',
    role: VtFlowRole.Validator,
    variant: VtFlowVariant.OnboardingProcess,
    state: VtFlowState.AwaitingOr,
    participantId: '7',
    claims,
  }
  const vtFlowApi = {
    findById: vi.fn().mockResolvedValue(record),
    acceptOnboardingRequest: vi.fn().mockResolvedValue(undefined),
    markValidated: vi.fn().mockResolvedValue(undefined),
    offerCredentialForSession: vi.fn().mockResolvedValue({ record: { ...record, state: 'CRED_OFFERED' } }),
  }
  const jscEntry = {
    'vpr:verana:vna-test-1:cs:5': {
      verifiablePresentation: {
        verifiableCredential: [{ id: 'https://issuer.example/vt/schemas-5-jsc.json' }],
      },
    },
  }
  const didRecord = {
    did: 'did:web:issuer.example',
    metadata: { get: (key: string) => (key === '_vt/jsc' ? jscEntry : undefined) },
  }
  const agent = {
    did: 'did:web:issuer.example',
    dids: { getCreatedDids: async () => [didRecord] },
    veranaChain: {
      getChainId: 'vna-test-1',
      getParticipant: vi.fn().mockResolvedValue(holder),
      setParticipantOPToValidated: vi.fn().mockResolvedValue(undefined),
    },
    w3cCredentials: { signCredential: async ({ credential }: { credential: unknown }) => credential },
    dependencyManager: { resolve: () => vtFlowApi },
  }
  const indexer = { getCredentialSchema: vi.fn().mockResolvedValue({ id: 5, json_schema: SCHEMA_JSON }) }

  const orchestrator = new VtFlowOrchestrator(agent as never, { indexer: indexer as never })
  return { orchestrator, vtFlowApi }
}

describe('VtFlowOrchestrator credential-claims validation', () => {
  it('rejects issuance when the claims do not satisfy the schema (e.g. missing required fields)', async () => {
    const { orchestrator, vtFlowApi } = makeOrchestrator({})

    await expect(
      orchestrator.validateAndOfferCredential({ vtFlowRecordId: 'rec-1', credentialSchemaId: '5' }),
    ).rejects.toThrow(/Invalid claims/)

    expect(vtFlowApi.offerCredentialForSession).not.toHaveBeenCalled()
  })

  it('offers the credential when claims satisfy the schema', async () => {
    const { orchestrator, vtFlowApi } = makeOrchestrator({ name: 'Acme Org', countryCode: 'US' })

    await expect(
      orchestrator.validateAndOfferCredential({ vtFlowRecordId: 'rec-1', credentialSchemaId: '5' }),
    ).resolves.toBeDefined()

    expect(vtFlowApi.offerCredentialForSession).toHaveBeenCalled()
  })
})
