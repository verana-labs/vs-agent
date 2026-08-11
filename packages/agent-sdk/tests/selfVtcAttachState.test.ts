import { describe, expect, it, vi } from 'vitest'

import { mapToSelfTr, presentations } from '../src/utils/setupSelfTr'
import { saveMetadataEntry } from '../src/utils/trustCredentialStore'

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

describe('self-issued VTC attach state', () => {
  it('keeps the self-issued entries when a json schema credential is stored', async () => {
    const record = makeRecord()
    await storeReal(record, '_vt/jsc')

    expect(record.attachedFlags()).toEqual([true, true])
    expect(record.didDocument.service.map(s => s.id)).toContain(serviceIdFor(selfIds[0]))
  })
})
