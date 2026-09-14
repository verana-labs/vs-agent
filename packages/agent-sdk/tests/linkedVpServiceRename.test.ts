import {
  JsonTransformer,
  W3cV2Credential,
  W3cV2DataIntegrityVerifiableCredential,
  W3cV2Presentation,
} from '@credo-ts/core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes of ${url}`) })) },
}))

import { getEcsSchemas } from '../src/utils/data'
import { publishSelfIssuedEcsPresentation } from '../src/utils/selfIssuedEcsCredential'
import { EcsClaims } from '../src/utils/ecsClaims'

// A host whose name contains an ECS schema key, so a `contains` test matches every service.
const PUBLIC_URL = 'https://ecs-org-issuer.example'
const DID = 'did:web:ecs-org-issuer.example'
const TYPE = ['VerifiableCredential', 'VerifiableTrustCredential']

const ecsClaims: EcsClaims = {
  org: {
    name: 'Test Org',
    logoUri: 'https://example.com/logo.svg',
    registryId: 'ID-123',
    registryUri: 'https://example.com/registry',
    address: 'Some address',
    countryCode: 'EE',
    organizationKind: 'PUBLIC',
  },
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

/** An agent already serving its DIDComm endpoints and its self-issued Service credential. */
function makeAgent() {
  const vm = `${DID}#key-1`
  const didDocument = {
    verificationMethod: [{ id: vm, type: 'Ed25519VerificationKey2020', controller: DID }],
    assertionMethod: [vm],
    service: [
      { id: `${DID}#did-communication`, type: 'did-communication', serviceEndpoint: `wss://${DID.slice(8)}` },
      {
        id: `${DID}#vpr-schemas-service-vtc-vp`,
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: `${PUBLIC_URL}/vt/ecs-service-vtc-vp.json`,
      },
      {
        id: `${DID}#whois`,
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: `${PUBLIC_URL}/vt/ecs-service-vtc-vp.json`,
      },
    ] as { id: string; type: string; serviceEndpoint: string }[],
  }
  const store: Record<string, unknown> = {}
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
  const agent = {
    did: DID,
    config: { logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } },
    dids: { getCreatedDids: async () => [didRecord], update: vi.fn() },
    w3cV2Credentials: {
      signCredential: async ({ credential }: { credential: W3cV2Credential }) =>
        new W3cV2DataIntegrityVerifiableCredential({
          securedCredential: {
            ...JsonTransformer.toJSON(credential),
            proof: { type: 'DataIntegrityProof', verificationMethod: vm },
          },
        }),
      signPresentation: async ({ presentation }: { presentation: W3cV2Presentation }) => ({
        securedPresentation: { ...presentation.toJSON(), proof: { type: 'DataIntegrityProof' } },
      }),
    },
    context: { dependencyManager: { isRegistered: () => false, resolve: () => ({ update: vi.fn() }) } },
  }
  return { agent, didDocument }
}

async function publishOrgCredential(agent: unknown) {
  await publishSelfIssuedEcsPresentation(
    agent as never,
    `${PUBLIC_URL}/vt/ecs-org-vtc-vp.json`,
    getEcsSchemas(PUBLIC_URL),
    'ecs-org',
    TYPE,
    { id: `${PUBLIC_URL}/vt/schemas-29-jsc.json`, type: 'JsonSchemaCredential' } as never,
    ecsClaims,
  )
}

describe('linked VP service rename on a host whose name contains an ECS schema key', () => {
  it('leaves the DIDComm service untouched', async () => {
    const { agent, didDocument } = makeAgent()

    await publishOrgCredential(agent)

    const didcomm = didDocument.service.find(s => s.type === 'did-communication')
    expect(didcomm?.id).toBe(`${DID}#did-communication`)
    expect(didcomm?.serviceEndpoint).toBe(`wss://${DID.slice(8)}`)
  })

  it('keeps the Service credential linked VP alongside the Organization one', async () => {
    const { agent, didDocument } = makeAgent()

    await publishOrgCredential(agent)

    const byId = Object.fromEntries(didDocument.service.map(s => [s.id, s.serviceEndpoint]))
    expect(byId[`${DID}#vpr-schemas-service-vtc-vp`]).toBe(`${PUBLIC_URL}/vt/ecs-service-vtc-vp.json`)
    expect(byId[`${DID}#vpr-schemas-org-vtc-vp`]).toBe(`${PUBLIC_URL}/vt/ecs-org-vtc-vp.json`)
  })

  it('leaves #whois pointing at the Service credential', async () => {
    const { agent, didDocument } = makeAgent()

    await publishOrgCredential(agent)

    const whois = didDocument.service.find(s => s.id === `${DID}#whois`)
    expect(whois?.serviceEndpoint).toBe(`${PUBLIC_URL}/vt/ecs-service-vtc-vp.json`)
  })
})
