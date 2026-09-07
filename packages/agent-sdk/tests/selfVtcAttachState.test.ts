import { describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes of ${url}`) })) },
}))

import { getEcsSchemas } from '../src/utils/data'
import { publishSelfIssuedEcsPresentation } from '../src/utils/selfIssuedEcsCredential'
import { generateDigestSRI, getClaims, linkedVpFragment } from '../src/utils/setupSelfTr'
import { findMetadataEntry } from '../src/utils/trustCredentialStore'
import { EcsClaims } from '../src/utils/ecsClaims'

const PUBLIC_URL = 'https://agent.example'
const DID = 'did:web:agent.example'

const schemaKey = 'ecs-service'
const staleSchemaId = `${PUBLIC_URL}/vt/schemas-old-jsc.json`
const targetSchemaId = `${PUBLIC_URL}/vt/schemas-5-jsc.json`
const linkedServiceId = `${DID}#${linkedVpFragment(schemaKey)}`
const VP_ID = `${PUBLIC_URL}/vt/${schemaKey}-vtc-vp.json`
const TYPE = ['VerifiableCredential', 'VerifiableTrustCredential']
const targetCredentialSchema = { id: targetSchemaId, type: 'JsonSchemaCredential' } as never
const schemas = getEcsSchemas(PUBLIC_URL)
const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }

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
}

async function unchangedIntegrityData() {
  const claims = await getClaims(logger as never, schemas, { id: DID }, schemaKey, ecsClaims)
  const data = { id: VP_ID, type: TYPE, credentialSchema: targetCredentialSchema, claims }
  return generateDigestSRI(JSON.stringify(data, Object.keys(data).sort()))
}

function agentAfterRealCredential(integrityData: string) {
  const vm = `${DID}#key-1`
  const didDocument = {
    verificationMethod: [{ id: vm, type: 'Ed25519VerificationKey2020', controller: DID }],
    assertionMethod: [vm],
    service: [] as { id: string }[],
  }
  const store: Record<string, unknown> = {
    '_vt/vtc': {
      [targetSchemaId]: {
        integrityData,
        attached: false,
        verifiablePresentation: { id: VP_ID },
        didDocumentServiceId: linkedServiceId,
      },
    },
  }
  const didRecord = {
    did: DID,
    didDocument,
    metadata: {
      get: (k: string) => store[k],
      set: (k: string, v: unknown) => {
        store[k] = v
      },
    },
  }
  return {
    agent: {
      did: DID,
      config: { logger },
      dids: { getCreatedDids: async () => [didRecord], update: vi.fn() },
      w3cCredentials: {
        signCredential: async (o: never) => ({ ...(o as { credential: object }).credential, proof: {} }),
        signPresentation: async (o: never) => ({
          ...(o as { presentation: object }).presentation,
          id: VP_ID,
          proof: {},
        }),
      },
      context: { dependencyManager: { resolve: () => ({ update: vi.fn() }) } },
    },
    didDocument,
  }
}

describe('findMetadataEntry with several entries for one presentation URL', () => {
  const vpUrl = `${PUBLIC_URL}/vt/ecs-service-vtc-vp.json`
  const jscUrl = `${PUBLIC_URL}/vt/schemas-5-jsc.json`
  const recordWith = (entries: Record<string, unknown>) => ({ metadata: { get: () => entries } }) as never

  it('serves the entry the DID Document announces, whatever the insertion order', () => {
    const found = findMetadataEntry(
      recordWith({
        [staleSchemaId]: { attached: false, verifiablePresentation: { id: vpUrl, holder: 'detached' } },
        [jscUrl]: { attached: true, verifiablePresentation: { id: vpUrl, holder: 'attached' } },
      }),
      '_vt/vtc',
      vpUrl,
    )

    expect(found?.schemaId).toBe(jscUrl)
    expect(found?.data.holder).toBe('attached')
  })

  it('falls back to a detached entry when no announced one matches', () => {
    const found = findMetadataEntry(
      recordWith({
        [staleSchemaId]: { attached: false, verifiablePresentation: { id: vpUrl, holder: 'detached' } },
      }),
      '_vt/vtc',
      vpUrl,
    )

    expect(found?.schemaId).toBe(staleSchemaId)
    expect(found?.data.holder).toBe('detached')
  })
})

describe('self-issued VTC attach state', () => {
  it('does not republish a detached self-issued service on the next boot', async () => {
    const { agent, didDocument } = agentAfterRealCredential(await unchangedIntegrityData())

    await publishSelfIssuedEcsPresentation(
      agent as never,
      VP_ID,
      schemas,
      schemaKey,
      TYPE,
      targetCredentialSchema,
      ecsClaims,
    )

    expect(didDocument.service.map(s => s.id)).not.toContain(linkedServiceId)
  })
})
