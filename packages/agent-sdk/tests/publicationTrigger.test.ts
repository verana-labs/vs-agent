import { DidDocumentService } from '@credo-ts/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/blockchain/triggerResolver', () => ({ scheduleTriggerResolverForOwnDid: vi.fn() }))

import { scheduleTriggerResolverForOwnDid } from '../src/blockchain/triggerResolver'
import { publicationFingerprint } from '../src/utils/publishedDidRecord'
import {
  deleteMetadataEntry,
  detachVtjscPublications,
  saveMetadataEntry,
} from '../src/utils/trustCredentialStore'

const DID = 'did:web:agent.example'
const JSC_URL = 'https://ecosystem.example/vt/schemas-12-jsc.json'
const VP_URL = 'https://agent.example/vt/schemas-12-vtc-vp.json'
const SERVICE_ID = `${DID}#vpr-schemas-12-vtc-vp`
const CAUSE = 'the published Verifiable Trust material changed'
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const lvp = (id: string, serviceEndpoint: string) => ({
  id,
  type: 'LinkedVerifiablePresentation',
  serviceEndpoint,
})
const didcomm = {
  id: `${DID}#didcomm`,
  type: 'DIDCommMessaging',
  serviceEndpoint: 'https://agent.example/didcomm',
}

// a data model 1.1 credential and presentation, which the store keeps as given
function credential(proofValue: string) {
  return {
    credentialSchema: { id: JSC_URL, type: 'JsonSchemaCredential' },
    credentialSubject: { id: DID, name: 'Acme' },
    proof: { type: 'Ed25519Signature2020', proofValue },
  } as never
}

function presentation(proofValue: string) {
  return {
    id: VP_URL,
    holder: DID,
    verifiableCredential: [credential(proofValue)],
    proof: { type: 'Ed25519Signature2020', proofValue },
  } as never
}

// the agent as the store sees it, with a repository that holds a JSON copy of the record between writes
function makeAgent(
  store: Record<string, Record<string, unknown>>,
  services: { id: string; type: string; serviceEndpoint: string }[],
) {
  const didDocument = { id: DID, service: services.map(service => new DidDocumentService(service)) }
  const metadata = {
    get: (key: string) => store[key],
    set: (key: string, value: Record<string, unknown>) => {
      store[key] = value
    },
  }
  const didRecord = { id: 'did-record', did: DID, didDocument, metadata }
  const snapshot = () => {
    const copy = JSON.parse(JSON.stringify({ didDocument, store }))
    return { didDocument: copy.didDocument, metadata: { get: (key: string) => copy.store[key] } }
  }
  let stored = snapshot()
  const repo = {
    findById: vi.fn(async () => stored),
    update: vi.fn(async () => {
      stored = snapshot()
    }),
  }
  const agent = {
    did: DID,
    config: { logger },
    context: { dependencyManager: { resolve: () => repo } },
    dids: { getCreatedDids: async () => [didRecord], update: vi.fn() },
  }
  return { agent: agent as never, didRecord: didRecord as never }
}

describe('publicationFingerprint', () => {
  it('ignores key order and non-LinkedVerifiablePresentation entries, and sees a presentation change', () => {
    const base = {
      didDocument: { service: [didcomm, lvp(SERVICE_ID, VP_URL)] },
      metadata: {
        get: (key: string) =>
          key === '_vt/vtc'
            ? { [JSC_URL]: { verifiablePresentation: { id: VP_URL, proof: { proofValue: 'a' } } } }
            : undefined,
      },
    }
    const reordered = {
      didDocument: {
        service: [lvp(SERVICE_ID, VP_URL), { ...didcomm, serviceEndpoint: 'wss://agent.example/didcomm' }],
      },
      metadata: {
        get: (key: string) =>
          key === '_vt/vtc'
            ? { [JSC_URL]: { verifiablePresentation: { proof: { proofValue: 'a' }, id: VP_URL } } }
            : undefined,
      },
    } as never
    expect(publicationFingerprint(reordered)).toBe(publicationFingerprint(base as never))

    const reissued = {
      ...base,
      metadata: {
        get: (key: string) =>
          key === '_vt/vtc'
            ? { [JSC_URL]: { verifiablePresentation: { id: VP_URL, proof: { proofValue: 'b' } } } }
            : undefined,
      },
    } as never
    expect(publicationFingerprint(reissued)).not.toBe(publicationFingerprint(base as never))
    expect(publicationFingerprint({ ...base, didDocument: { service: [didcomm] } } as never)).not.toBe(
      publicationFingerprint(base as never),
    )
    expect(publicationFingerprint(null)).toBe('')
  })
})

describe('TriggerResolver from the DID record write point ([VSA-VT-LVP-5])', () => {
  const scheduled = vi.mocked(scheduleTriggerResolverForOwnDid)
  beforeEach(() => scheduled.mockClear())

  it('sends one trigger when a linked VP is published, none when the same one is saved again, one when it is reissued', async () => {
    const { agent, didRecord } = makeAgent({}, [didcomm])

    await saveMetadataEntry(agent, didRecord, credential('a'), presentation('a'), SERVICE_ID, '_vt/vtc')
    expect(scheduled).toHaveBeenCalledTimes(1)
    expect(scheduled).toHaveBeenCalledWith(agent, CAUSE)

    await saveMetadataEntry(agent, didRecord, credential('a'), presentation('a'), SERVICE_ID, '_vt/vtc')
    expect(scheduled).toHaveBeenCalledTimes(1)

    await saveMetadataEntry(agent, didRecord, credential('b'), presentation('b'), SERVICE_ID, '_vt/vtc')
    expect(scheduled).toHaveBeenCalledTimes(2)
  })

  it('sends a trigger when a linked VP is removed, and when a VTJSC publication is detached', async () => {
    const vtc = { [JSC_URL]: { verifiablePresentation: { id: VP_URL }, didDocumentServiceId: SERVICE_ID } }
    const removed = makeAgent({ '_vt/vtc': vtc }, [didcomm, lvp(SERVICE_ID, VP_URL)])
    await deleteMetadataEntry(removed.agent, JSC_URL, removed.didRecord, '_vt/vtc')
    expect(scheduled).toHaveBeenCalledTimes(1)

    const jscServiceId = `${DID}#vpr-schemas-12-vtjsc-vp`
    const jsc = {
      'vpr:verana:vna-devnet-1:cs:12': {
        verifiablePresentation: { id: VP_URL },
        didDocumentServiceId: jscServiceId,
      },
    }
    const detached = makeAgent({ '_vt/jsc': jsc }, [didcomm, lvp(jscServiceId, VP_URL)])
    await detachVtjscPublications(detached.agent, ['vpr:verana:vna-devnet-1:cs:12'])
    expect(scheduled).toHaveBeenCalledTimes(2)
  })
})
