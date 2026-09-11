import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  AnonCredsTrustService,
} from '../src/blockchain/AnonCredsTrustService'
import { ParticipantRole, ParticipantState } from '../src/blockchain/types'

const CHAIN_ID = 'vna-test-1'
const CREDENTIAL_SCHEMA_ID = 7
const ECOSYSTEM_ID = 3
const SCHEMA_REFERENCE = `vpr:verana:${CHAIN_ID}:cs:${CREDENTIAL_SCHEMA_ID}`
const LEGACY_SCHEMA_REFERENCE = 'https://ecosystem.example/vt/cs/v1/js/ecs-org'

const ECOSYSTEM_DID = 'did:webvh:QmEcosystem:ecosystem.example'
const ISSUER_DID = 'did:webvh:QmIssuer:issuer.example'
const AGENT_DID = 'did:webvh:QmAgent:agent.example'

const JSON_SCHEMA_CREDENTIAL_ID = 'https://ecosystem.example/vt/schemas-org-jsc.json'
const ANONCREDS_SCHEMA_ID = 'did:webvh:QmEcosystem:ecosystem.example/resources/zSchema'
const CREDENTIAL_DEFINITION_ID = 'did:webvh:QmIssuer:issuer.example/resources/zCredDef'

function vtjscDocument(overrides: Record<string, unknown> = {}) {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: JSON_SCHEMA_CREDENTIAL_ID,
    type: ['VerifiableCredential', 'JsonSchemaCredential'],
    issuer: ECOSYSTEM_DID,
    issuanceDate: '2026-01-01T00:00:00Z',
    credentialSubject: { id: SCHEMA_REFERENCE, jsonSchema: { $ref: SCHEMA_REFERENCE } },
    proof: {
      type: 'Ed25519Signature2020',
      created: '2026-01-01T00:00:00Z',
      verificationMethod: `${ECOSYSTEM_DID}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: 'zProofValue',
    },
    ...overrides,
  }
}

/** The VTJSC as this agent publishes it: data model 2.0, secured with a DataIntegrityProof */
function vtjscDocumentV2(overrides: Record<string, unknown> = {}) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: JSON_SCHEMA_CREDENTIAL_ID,
    type: ['VerifiableCredential', 'JsonSchemaCredential'],
    issuer: ECOSYSTEM_DID,
    validFrom: '2026-01-01T00:00:00Z',
    credentialSubject: { id: SCHEMA_REFERENCE, jsonSchema: { $ref: SCHEMA_REFERENCE } },
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: '2026-01-01T00:00:00Z',
      verificationMethod: `${ECOSYSTEM_DID}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: 'zProofValue',
    },
    ...overrides,
  }
}

interface AgentOptions {
  vtjsc?: Record<string, unknown>
  proofIsValid?: boolean
  credentialDefinitionMetadata?: Record<string, unknown>
  schemaMetadata?: Record<string, unknown>
  ecosystemDid?: string
  participants?: Array<Record<string, unknown>>
  listParticipants?: ReturnType<typeof vi.fn>
  chainId?: string
}

function makeAgent(options: AgentOptions = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => options.vtjsc ?? vtjscDocument(),
  }))
  vi.stubGlobal('fetch', fetchMock)

  const listParticipants =
    options.listParticipants ?? vi.fn(async () => options.participants ?? [activeParticipant()])

  const agent = {
    did: AGENT_DID,
    veranaChain: { getChainId: options.chainId ?? CHAIN_ID },
    indexer: {
      getCredentialSchema: vi.fn(async () => ({
        id: CREDENTIAL_SCHEMA_ID,
        ecosystem_id: ECOSYSTEM_ID,
      })),
      getEcosystem: vi.fn(async () => ({
        id: ECOSYSTEM_ID,
        did: options.ecosystemDid ?? ECOSYSTEM_DID,
      })),
      listParticipants,
    },
    modules: {
      anoncreds: {
        getCreatedCredentialDefinitions: vi.fn(async () => []),
        getCreatedSchemas: vi.fn(async () => []),
        getCredentialDefinition: vi.fn(async () => ({
          credentialDefinition: { issuerId: ISSUER_DID, schemaId: ANONCREDS_SCHEMA_ID },
          credentialDefinitionMetadata: options.credentialDefinitionMetadata ?? {
            relatedJsonSchemaCredentialId: JSON_SCHEMA_CREDENTIAL_ID,
          },
          resolutionMetadata: {},
        })),
        getSchema: vi.fn(async () => ({
          schema: { issuerId: ECOSYSTEM_DID, name: 'OrganizationCredential' },
          schemaMetadata: options.schemaMetadata ?? {
            relatedJsonSchemaCredentialId: JSON_SCHEMA_CREDENTIAL_ID,
          },
          resolutionMetadata: {},
        })),
      },
    },
    w3cCredentials: {
      verifyCredential: vi.fn(async () => ({ isValid: options.proofIsValid ?? true })),
    },
    w3cV2Credentials: {
      verifyCredential: vi.fn(async () => ({ isValid: options.proofIsValid ?? true })),
    },
  }

  return { agent, fetchMock, listParticipants, service: new AnonCredsTrustService(agent as never) }
}

function activeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    did: AGENT_DID,
    role: ParticipantRole.Issuer,
    schema_id: CREDENTIAL_SCHEMA_ID,
    participant_state: ParticipantState.Active,
    ...overrides,
  }
}

async function reasonOf(promise: Promise<unknown>): Promise<AnonCredsTrustErrorReason> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AnonCredsTrustError) return error.reason
    throw error
  }
  throw new Error('the call resolved, and it was expected to throw')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('deriveCredentialSchema', () => {
  it('derives the CredentialSchema and the Ecosystem DID of a credential definition', async () => {
    const { service } = makeAgent()

    const derived = await service.deriveCredentialSchema({
      credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
    })

    expect(derived).toEqual({
      credentialSchemaId: CREDENTIAL_SCHEMA_ID,
      ecosystemDid: ECOSYSTEM_DID,
      jsonSchemaCredentialId: JSON_SCHEMA_CREDENTIAL_ID,
      anonCredsSchemaId: ANONCREDS_SCHEMA_ID,
      issuerId: ISSUER_DID,
    })
  })

  it('derives the CredentialSchema and the Ecosystem DID of an AnonCreds schema', async () => {
    const { service } = makeAgent()

    const derived = await service.deriveCredentialSchema({ schemaId: ANONCREDS_SCHEMA_ID })

    expect(derived.credentialSchemaId).toBe(CREDENTIAL_SCHEMA_ID)
    expect(derived.ecosystemDid).toBe(ECOSYSTEM_DID)
    expect(derived.anonCredsSchemaId).toBe(ANONCREDS_SCHEMA_ID)
    expect(derived.issuerId).toBeUndefined()
  })

  it('reads the VTJSC of a locally created object from its record tag', async () => {
    const { agent, service } = makeAgent()
    agent.modules.anoncreds.getCreatedCredentialDefinitions = vi.fn(async () => [
      {
        credentialDefinition: { issuerId: AGENT_DID, schemaId: ANONCREDS_SCHEMA_ID },
        getTag: () => JSON_SCHEMA_CREDENTIAL_ID,
      },
    ]) as never

    const derived = await service.deriveCredentialSchema({
      credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
    })

    expect(derived.issuerId).toBe(AGENT_DID)
    expect(agent.modules.anoncreds.getCredentialDefinition).not.toHaveBeenCalled()
  })

  it('fails when the resource metadata carries no relatedJsonSchemaCredentialId', async () => {
    const { service } = makeAgent({ credentialDefinitionMetadata: {} })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('fails when the document of the VTJSC carries no proof', async () => {
    const { proof: _proof, ...unsigned } = vtjscDocument()
    const { service } = makeAgent({ vtjsc: unsigned })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('fails when the proof of the VTJSC is invalid', async () => {
    const { service } = makeAgent({ proofIsValid: false })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('verifies a data model 2.0 VTJSC through the Data Integrity API', async () => {
    const { agent, service } = makeAgent({ vtjsc: vtjscDocumentV2() })

    const derived = await service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID })

    expect(derived.jsonSchemaCredentialId).toBe(JSON_SCHEMA_CREDENTIAL_ID)
    expect(agent.w3cV2Credentials.verifyCredential).toHaveBeenCalledTimes(1)
    expect(agent.w3cCredentials.verifyCredential).not.toHaveBeenCalled()
  })

  it('fails when the proof of a data model 2.0 VTJSC is invalid', async () => {
    const { service } = makeAgent({ vtjsc: vtjscDocumentV2(), proofIsValid: false })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('fails when the issuer of the VTJSC is not the DID of the Ecosystem', async () => {
    const { service } = makeAgent({ ecosystemDid: 'did:webvh:QmOther:other.example' })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('fails when the $ref of the VTJSC is no vpr reference', async () => {
    const { service } = makeAgent({
      vtjsc: vtjscDocument({
        credentialSubject: { jsonSchema: { $ref: LEGACY_SCHEMA_REFERENCE } },
      }),
    })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('fails when the VTJSC names another chain', async () => {
    const { service } = makeAgent({ chainId: 'vna-devnet-1' })

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('fails when the VPR holds no CredentialSchema of the reference', async () => {
    const { agent, service } = makeAgent()
    agent.indexer.getCredentialSchema = vi.fn(async () => undefined) as never

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.NotDerivable)
  })

  it('reports an indexer that does not answer as unavailable', async () => {
    const { agent, service } = makeAgent()
    agent.indexer.getCredentialSchema = vi.fn(async () => {
      throw new Error('the indexer is unreachable')
    }) as never

    const reason = await reasonOf(
      service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }),
    )

    expect(reason).toBe(AnonCredsTrustErrorReason.Unavailable)
  })

  it('reads the VTJSC once for two credential definitions of the same VTJSC', async () => {
    const { fetchMock, service } = makeAgent()

    await service.deriveCredentialSchema({ credentialDefinitionId: CREDENTIAL_DEFINITION_ID })
    await service.deriveCredentialSchema({ credentialDefinitionId: `${CREDENTIAL_DEFINITION_ID}2` })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('assertAuthorized', () => {
  const authorization = {
    did: AGENT_DID,
    role: ParticipantRole.Issuer,
    credentialSchemaId: CREDENTIAL_SCHEMA_ID,
  }

  it('passes with one active Participant entry', async () => {
    const { service, listParticipants } = makeAgent()

    await expect(service.assertAuthorized(authorization)).resolves.toBeUndefined()
    expect(listParticipants).toHaveBeenCalledWith({
      did: AGENT_DID,
      role: ParticipantRole.Issuer,
      schemaId: CREDENTIAL_SCHEMA_ID,
      participantState: ParticipantState.Active,
    })
  })

  it('fails with no Participant entry', async () => {
    const { service } = makeAgent({ participants: [] })

    expect(await reasonOf(service.assertAuthorized(authorization))).toBe(
      AnonCredsTrustErrorReason.NotAuthorized,
    )
  })

  it('fails with an entry for another role', async () => {
    const { service } = makeAgent({
      participants: [activeParticipant({ role: ParticipantRole.Verifier })],
    })

    expect(await reasonOf(service.assertAuthorized(authorization))).toBe(
      AnonCredsTrustErrorReason.NotAuthorized,
    )
  })

  it('fails with an entry for another CredentialSchema', async () => {
    const { service } = makeAgent({ participants: [activeParticipant({ schema_id: 9 })] })

    expect(await reasonOf(service.assertAuthorized(authorization))).toBe(
      AnonCredsTrustErrorReason.NotAuthorized,
    )
  })

  it('reports an indexer failure as unavailable, and not as not authorized', async () => {
    const { service } = makeAgent({
      listParticipants: vi.fn(async () => {
        throw new Error('the indexer is unreachable')
      }),
    })

    expect(await reasonOf(service.assertAuthorized(authorization))).toBe(
      AnonCredsTrustErrorReason.Unavailable,
    )
  })

  it('treats did:web and did:webvh of the same host as different DIDs', async () => {
    const { service } = makeAgent({
      participants: [activeParticipant({ did: 'did:web:agent.example' })],
    })

    expect(
      await reasonOf(service.assertAuthorized({ ...authorization, did: 'did:webvh:Qm1:agent.example' })),
    ).toBe(AnonCredsTrustErrorReason.NotAuthorized)
  })
})

describe('findUnaccreditedDids', () => {
  it('reads once per DID, and separates the unaccredited from the unchecked', async () => {
    const authorized = 'did:webvh:QmOne:one.example'
    const unauthorized = 'did:webvh:QmTwo:two.example'
    const unreachable = 'did:webvh:QmThree:three.example'

    const listParticipants = vi.fn(async ({ did }: { did?: string }) => {
      if (did === unreachable) throw new Error('the indexer is unreachable')
      return did === authorized ? [activeParticipant({ did: authorized })] : []
    })

    const { service } = makeAgent({ listParticipants })

    const result = await service.findUnaccreditedDids(
      [authorized, unauthorized, unreachable, authorized],
      ParticipantRole.Issuer,
      CREDENTIAL_SCHEMA_ID,
    )

    expect(result).toEqual({ unaccredited: [unauthorized], unchecked: [unreachable] })
    expect(listParticipants).toHaveBeenCalledTimes(3)
  })
})
