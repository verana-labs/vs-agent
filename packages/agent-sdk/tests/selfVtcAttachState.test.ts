import { describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes of ${url}`) })) },
}))

import { getEcsSchemas } from '../src/utils/data'
import {
  generateDigestSRI,
  generateVerifiablePresentation,
  getClaims,
  linkedVpFragment,
  mapToSelfTr,
  presentations,
  SelfTrDefaults,
} from '../src/utils/setupSelfTr'
import { findMetadataEntry, saveMetadataEntry } from '../src/utils/trustCredentialStore'

const PUBLIC_URL = 'https://agent.example'
const DID = 'did:web:agent.example'
const CRED_ID = `${PUBLIC_URL}/vt/cred-1.json`
const SCHEMA_REF = 'vpr:verana:vna-demo-1:cs:9'

const selfIds = presentations.map(p => mapToSelfTr(p.schemaUrl, PUBLIC_URL))
const serviceIdFor = (schemaId: string) => `${DID}#vpr-${schemaId.split('/').pop()}-vtc-vp`

function makeRecord() {
  const vtc = Object.fromEntries(
    selfIds.map(id => [
      id,
      {
        credential: {},
        verifiablePresentation: { id: `${id}-vp.json` },
        didDocumentServiceId: serviceIdFor(id),
        attached: true,
      },
    ]),
  )
  const store: Record<string, unknown> = { '_vt/vtc': vtc }
  return {
    did: DID,
    didDocument: {
      service: selfIds.map(id => ({
        id: serviceIdFor(id),
        serviceEndpoint: `${id}-vp.json`,
        type: 'LinkedVerifiablePresentation',
      })),
    },
    metadata: {
      get: (k: string) => store[k],
      set: (k: string, v: unknown) => {
        store[k] = v
      },
    },
    attachedFlags: () =>
      selfIds.map(id => (store['_vt/vtc'] as Record<string, { attached: boolean }>)[id].attached),
  }
}

const agent = {
  did: DID,
  context: { dependencyManager: { resolve: () => ({ update: vi.fn() }) } },
  dids: { update: vi.fn() },
} as never

const credential = {
  id: CRED_ID,
  jsonCredential: { id: CRED_ID },
  credentialSchema: { id: SCHEMA_REF },
  credentialSubject: { id: SCHEMA_REF },
} as never

const presentation = { id: `${PUBLIC_URL}/vt/cred-1-vp.json` } as never

const storeReal = (record: ReturnType<typeof makeRecord>, key: '_vt/vtc' | '_vt/jsc') =>
  saveMetadataEntry(agent, record as never, credential, presentation, `${DID}#vpr-real`, key, PUBLIC_URL)

const target = presentations[0]
const schemaKey = target.name
const targetSchemaId = mapToSelfTr(target.schemaUrl, PUBLIC_URL)
const linkedServiceId = `${DID}#${linkedVpFragment(schemaKey)}`
const VP_ID = `${PUBLIC_URL}/vt/${schemaKey}-vtc-vp.json`
const TYPE = ['VerifiableCredential', 'VerifiableTrustCredential']
const targetCredentialSchema = { id: targetSchemaId, type: 'JsonSchemaCredential' } as never
const schemas = getEcsSchemas(PUBLIC_URL)
const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }

const defaults: SelfTrDefaults = {
  agentLabel: 'Agent',
  serviceLogoUri: 'https://cdn.example/logo.png',
  serviceType: 'ECommerce',
  serviceDescription: 'demo',
  serviceMinimumAgeRequired: 18,
  serviceTermsAndConditions: 'https://cdn.example/terms',
  servicePrivacyPolicy: 'https://cdn.example/privacy',
  orgRegistryId: 'REG-1',
  orgRegistryUri: 'https://registry.example',
  orgAddress: '1 Demo Street',
  orgOrganizationKind: 'PUBLIC',
  orgCountryCode: 'US',
}

async function unchangedIntegrityData() {
  const claims = await getClaims(logger as never, schemas, { id: DID }, schemaKey, defaults)
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
        [selfIds[0]]: { attached: false, verifiablePresentation: { id: vpUrl, holder: 'detached' } },
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
        [selfIds[0]]: { attached: false, verifiablePresentation: { id: vpUrl, holder: 'detached' } },
      }),
      '_vt/vtc',
      vpUrl,
    )

    expect(found?.schemaId).toBe(selfIds[0])
    expect(found?.data.holder).toBe('detached')
  })
})

describe('self-issued VTC attach state', () => {
  it('keeps the self-issued entries when a json schema credential is stored', async () => {
    const record = makeRecord()
    await storeReal(record, '_vt/jsc')

    expect(record.attachedFlags()).toEqual([true, true])
    expect(record.didDocument.service.map(s => s.id)).toContain(serviceIdFor(selfIds[0]))
  })

  it('does not republish a detached self-issued service on the next boot', async () => {
    const { agent, didDocument } = agentAfterRealCredential(await unchangedIntegrityData())

    await generateVerifiablePresentation(
      agent as never,
      VP_ID,
      schemas,
      schemaKey,
      TYPE,
      targetCredentialSchema,
      defaults,
    )

    expect(didDocument.service.map(s => s.id)).not.toContain(linkedServiceId)
  })
})
