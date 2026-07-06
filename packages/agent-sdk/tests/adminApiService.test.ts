import { DidDocument, DidDocumentService } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { applyAdminApiServiceEntry } from '../src/did/adminApiService'

const DID = 'did:web:agent.example.com'
const URL = 'https://admin.agent.example.com'

const adminEntries = (doc: DidDocument) => (doc.service ?? []).filter(s => s.type === 'VsAgentAdminAPI')

describe('applyAdminApiServiceEntry', () => {
  it('adds a single VsAgentAdminAPI entry with the verbatim endpoint when set', () => {
    const doc = new DidDocument({ id: DID })
    applyAdminApiServiceEntry(doc, URL)

    const entries = adminEntries(doc)
    expect(entries).toHaveLength(1)
    expect(entries[0].serviceEndpoint).toBe(URL)
    expect(entries[0].id.startsWith(DID)).toBe(true)
  })

  it('adds no entry and leaves other services untouched when unset', () => {
    const doc = new DidDocument({ id: DID })
    doc.service = [
      new DidDocumentService({
        id: `${DID}#didcomm`,
        type: 'DIDCommMessaging',
        serviceEndpoint: 'wss://agent',
      }),
      new DidDocumentService({
        id: `${DID}#vp`,
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: 'https://agent/vp.json',
      }),
    ]
    applyAdminApiServiceEntry(doc, undefined)

    expect(adminEntries(doc)).toHaveLength(0)
    expect(doc.service).toHaveLength(2)
  })

  it('is idempotent and reflects a changed endpoint without duplicating', () => {
    const doc = new DidDocument({ id: DID })
    applyAdminApiServiceEntry(doc, URL)
    applyAdminApiServiceEntry(doc, URL)
    expect(adminEntries(doc)).toHaveLength(1)

    applyAdminApiServiceEntry(doc, 'https://admin2.example.com')
    const entries = adminEntries(doc)
    expect(entries).toHaveLength(1)
    expect(entries[0].serviceEndpoint).toBe('https://admin2.example.com')
  })

  it('removes a stale entry when the endpoint becomes unset', () => {
    const doc = new DidDocument({ id: DID })
    applyAdminApiServiceEntry(doc, URL)
    expect(adminEntries(doc)).toHaveLength(1)

    applyAdminApiServiceEntry(doc, undefined)
    expect(adminEntries(doc)).toHaveLength(0)
  })

  it('emits a bare origin verbatim with no trailing slash', () => {
    const doc = new DidDocument({ id: DID })
    applyAdminApiServiceEntry(doc, 'https://admin.example.com')
    expect(adminEntries(doc)[0].serviceEndpoint).toBe('https://admin.example.com')
  })
})
