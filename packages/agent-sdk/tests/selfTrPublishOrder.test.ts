import { DidDocument, VerificationMethod } from '@credo-ts/core'
import { describe, expect, it, vi } from 'vitest'

import { getEcsSchemas } from '../src/utils/data'
import { generateVerifiablePresentation, SelfTrDefaults, sortKeysDeep } from '../src/utils/setupSelfTr'

const DID = 'did:web:agent.example'
const VP_URL = 'https://agent.example/vt/ecs-service-vtc-vp.json'
const JSC_URL = 'https://agent.example/vt/schemas-5-jsc.json'

vi.mock('axios', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: Buffer.from(`bytes of ${url}`) })) },
}))

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
      signCredential: async ({ credential }: { credential: unknown }) => credential,
      signPresentation: async ({ presentation }: { presentation: unknown }) => presentation,
    },
  }
  return { agent, metadata, repositoryUpdate, didsUpdate }
}

async function publish(agent: unknown, beforePublish: (vp: unknown) => Promise<void>) {
  return await generateVerifiablePresentation(
    agent as never,
    VP_URL,
    getEcsSchemas('https://agent.example'),
    'ecs-service',
    ['VerifiableCredential', 'VerifiableTrustCredential'],
    { id: JSC_URL, type: 'JsonSchemaCredential' },
    defaults,
    beforePublish,
  )
}

describe('generateVerifiablePresentation beforePublish step', () => {
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
    const changed: SelfTrDefaults = { ...defaults, serviceDescription: 'a different description' }
    await generateVerifiablePresentation(
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
