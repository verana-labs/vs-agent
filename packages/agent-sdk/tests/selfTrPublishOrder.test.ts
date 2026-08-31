import { DidDocument, VerificationMethod } from '@credo-ts/core'
import { describe, expect, it, vi } from 'vitest'

import { getEcsSchemas } from '../src/utils/data'
import { publishSelfIssuedEcsPresentation } from '../src/utils/selfIssuedEcsCredential'
import { sortKeysDeep } from '../src/utils/setupSelfTr'
import { EcsClaims } from '../src/utils/ecsClaims'

const DID = 'did:web:agent.example'
const VP_URL = 'https://agent.example/vt/ecs-service-vtc-vp.json'
const JSC_URL = 'https://agent.example/vt/schemas-5-jsc.json'
const SELF_TR_URL = 'https://agent.example/vt/cs/v1/js/ecs-service'

vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes of ${url}`) })) },
}))

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
  org: {
    name: 'Test Org',
    logoUri: 'https://example.com/logo.svg',
    registryId: 'ID-123',
    registryUri: 'https://example.com/registry',
    address: 'Some address',
    countryCode: 'EE',
    organizationKind: 'PUBLIC',
  },
}

function makeAgent() {
  const metadata = new Map<string, Record<string, unknown>>()
  const didRecord = {
    did: DID,
    didDocument: new DidDocument({
      id: DID,
      verificationMethod: [
        new VerificationMethod({
          id: `${DID}#key-1`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: 'z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG',
        }),
      ],
      assertionMethod: [`${DID}#key-1`],
    }),
    metadata: {
      get: (key: string) => metadata.get(key),
      set: (key: string, value: Record<string, unknown>) => metadata.set(key, value),
    },
  }
  const repositoryUpdate = vi.fn()
  const didsUpdate = vi.fn()
  const agent = {
    did: DID,
    config: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    dids: { getCreatedDids: async () => [didRecord], update: didsUpdate },
    context: { dependencyManager: { resolve: () => ({ update: repositoryUpdate }) } },
    w3cCredentials: {
      signCredential: async ({ credential }: { credential: object }) => ({
        ...credential,
        proof: { type: 'Ed25519Signature2020', verificationMethod: `${DID}#key-1` },
      }),
      signPresentation: async ({ presentation }: { presentation: unknown }) => presentation,
    },
  }
  return { agent, metadata, repositoryUpdate, didsUpdate }
}

async function publish(
  agent: unknown,
  beforePublish: (vp: unknown) => Promise<void>,
  credentialSchemaId = JSC_URL,
) {
  return await publishSelfIssuedEcsPresentation(
    agent as never,
    VP_URL,
    getEcsSchemas('https://agent.example'),
    'ecs-service',
    ['VerifiableCredential', 'VerifiableTrustCredential'],
    { id: credentialSchemaId, type: 'JsonSchemaCredential' },
    ecsClaims,
    beforePublish,
  )
}

function storedEntry(metadata: Map<string, any>, schemaId: string) {
  const entry = metadata.get('_vt/vtc')?.[schemaId]
  if (!entry) throw new Error(`no stored entry for ${schemaId}`)
  return entry
}

describe('publishSelfIssuedEcsPresentation beforePublish step', () => {
  it('receives the signed presentation and then publishes it', async () => {
    const { agent, metadata, repositoryUpdate } = makeAgent()
    const beforePublish = vi.fn(async (vp: any) => {
      expect(vp.verifiableCredential[0]).toBeDefined()
      expect(repositoryUpdate).not.toHaveBeenCalled()
    })

    await publish(agent, beforePublish)

    expect(beforePublish).toHaveBeenCalledTimes(1)
    expect(repositoryUpdate).toHaveBeenCalledTimes(1)
    expect(metadata.get('_vt/vtc')?.[JSC_URL]).toBeDefined()
  })

  it('keeps the presentation unpublished when the step fails', async () => {
    const { agent, metadata, repositoryUpdate, didsUpdate } = makeAgent()
    const beforePublish = vi.fn(async () => {
      throw new Error('chain is unreachable')
    })

    await expect(publish(agent, beforePublish)).rejects.toThrow('chain is unreachable')
    expect(repositoryUpdate).not.toHaveBeenCalled()
    expect(didsUpdate).not.toHaveBeenCalled()
    expect(metadata.get('_vt/vtc')).toBeUndefined()
  })

  it('regenerates when claims change, and skips when they do not', async () => {
    // beforePublish always fires, cache hit or not (it's how a failed publish retries), so
    // regeneration is observed via repositoryUpdate: it only runs when content actually changes.
    const { agent, repositoryUpdate } = makeAgent()
    const beforePublish = vi.fn(async () => {})

    await publish(agent, beforePublish)
    expect(repositoryUpdate).toHaveBeenCalledTimes(1)

    // Same claims again: cache hit, no regeneration.
    await publish(agent, beforePublish)
    expect(repositoryUpdate).toHaveBeenCalledTimes(1)

    // A changed claim must invalidate the cache and regenerate.
    const changed: EcsClaims = {
      ...ecsClaims,
      service: { ...ecsClaims.service, description: 'a different description' },
    }
    await publishSelfIssuedEcsPresentation(
      agent as never,
      VP_URL,
      getEcsSchemas('https://agent.example'),
      'ecs-service',
      ['VerifiableCredential', 'VerifiableTrustCredential'],
      { id: JSC_URL, type: 'JsonSchemaCredential' },
      changed,
      beforePublish,
    )
    expect(repositoryUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('stored self-issued VTC revalidation', () => {
  // integrityData never changes here: only the checks on the stored credential can regenerate it
  const beforePublish = async () => {}

  it('rebuilds when the proof names a verification method the DID Document no longer asserts', async () => {
    const { agent, metadata, repositoryUpdate } = makeAgent()

    await publish(agent, beforePublish)
    storedEntry(metadata, JSC_URL).credential.proof.verificationMethod = `${DID}#rotated-key`

    await publish(agent, beforePublish)

    expect(repositoryUpdate).toHaveBeenCalledTimes(2)
    expect(storedEntry(metadata, JSC_URL).credential.proof.verificationMethod).toBe(`${DID}#key-1`)
  })

  it('rebuilds when the stored credential is bound to another json schema credential', async () => {
    const { agent, metadata, repositoryUpdate } = makeAgent()

    await publish(agent, beforePublish)
    storedEntry(metadata, JSC_URL).credential.credentialSchema = { id: 'https://other.example/jsc.json' }

    await publish(agent, beforePublish)

    expect(repositoryUpdate).toHaveBeenCalledTimes(2)
    expect(storedEntry(metadata, JSC_URL).credential.credentialSchema.id).toBe(JSC_URL)
  })

  it('rebuilds when the stored credential was issued by another DID', async () => {
    const { agent, metadata, repositoryUpdate } = makeAgent()

    await publish(agent, beforePublish)
    storedEntry(metadata, JSC_URL).credential.issuer = 'did:web:someone-else.example'

    await publish(agent, beforePublish)

    expect(repositoryUpdate).toHaveBeenCalledTimes(2)
    expect(storedEntry(metadata, JSC_URL).credential.issuer).toBe(DID)
  })

  it('stores the self-issued default detached while another entry serves the same presentation URL', async () => {
    const { agent, metadata, didsUpdate } = makeAgent()

    await publish(agent, beforePublish)
    didsUpdate.mockClear()

    await publish(agent, beforePublish, SELF_TR_URL)

    expect(storedEntry(metadata, SELF_TR_URL).attached).toBe(false)
    expect(didsUpdate).not.toHaveBeenCalled()
  })
})

describe('sortKeysDeep', () => {
  it('sorts keys at every nesting level, including inside arrays', () => {
    const a = { b: 1, a: { d: 1, c: 2 }, list: [{ z: 1, a: 2 }] }
    const b = { a: { c: 2, d: 1 }, list: [{ a: 2, z: 1 }], b: 1 }

    // Differently-ordered but equivalent inputs must serialize identically.
    expect(JSON.stringify(sortKeysDeep(a))).toBe(JSON.stringify(sortKeysDeep(b)))
    expect(JSON.stringify(sortKeysDeep(a))).toBe('{"a":{"c":2,"d":1},"b":1,"list":[{"a":2,"z":1}]}')
  })

  it('leaves primitive and null values unchanged', () => {
    expect(sortKeysDeep('value')).toBe('value')
    expect(sortKeysDeep(42)).toBe(42)
    expect(sortKeysDeep(null)).toBeNull()
  })
})
