import { DidDocument, DidDocumentService, VerificationMethod } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import {
  alignSigningKeyRelations,
  findSigningVerificationMethodId,
  removeUnservedLinkedVpServices,
} from '../src/did/reusedDidDocument'

const DID = 'did:webvh:QmScid:agent.example'
const PUBLIC_URL = 'https://agent.example'
const UPDATE_KEY = `${DID}#mv1jHjTJ`
const SIGNING_KEY = `${DID}#z6Mkp3uGQYVyfKWvomdv8ykrwNxBv2vVRLadKZ1xNE6hC4W6`

const ed25519 = (id: string) =>
  new VerificationMethod({ id, controller: DID, type: 'Ed25519VerificationKey2020' })

const linkedVp = (fragment: string, serviceEndpoint: string) =>
  new DidDocumentService({ id: `${DID}#${fragment}`, type: 'LinkedVerifiablePresentation', serviceEndpoint })

/** The layout v1 leaves behind: the update key first and under `authentication`. */
function v1Document() {
  return new DidDocument({
    id: DID,
    verificationMethod: [ed25519(UPDATE_KEY), ed25519(SIGNING_KEY)],
    authentication: [UPDATE_KEY],
    assertionMethod: [SIGNING_KEY],
  })
}

describe('findSigningVerificationMethodId', () => {
  it('returns the assertion key, not the first Ed25519 verification method', () => {
    expect(findSigningVerificationMethodId(v1Document())).toBe(SIGNING_KEY)
  })

  it('returns nothing when the first assertion method is not an Ed25519 verification method', () => {
    const doc = v1Document()
    doc.assertionMethod = [`${DID}#key-agreement-1`]
    expect(findSigningVerificationMethodId(doc)).toBeUndefined()

    doc.assertionMethod = undefined
    expect(findSigningVerificationMethodId(doc)).toBeUndefined()
  })
})

describe('alignSigningKeyRelations', () => {
  it('lists only the signing key under authentication and assertionMethod', () => {
    const doc = v1Document()

    expect(alignSigningKeyRelations(doc)).toBe(true)
    expect(doc.authentication).toEqual([SIGNING_KEY])
    expect(doc.assertionMethod).toEqual([SIGNING_KEY])
  })

  it('removes other keys from assertionMethod', () => {
    const doc = v1Document()
    doc.authentication = [SIGNING_KEY]
    doc.assertionMethod = [SIGNING_KEY, UPDATE_KEY]

    expect(alignSigningKeyRelations(doc)).toBe(true)
    expect(doc.assertionMethod).toEqual([SIGNING_KEY])
  })

  it('reports no change for the layout of a newly created DID', () => {
    const doc = v1Document()
    doc.authentication = [SIGNING_KEY]

    expect(alignSigningKeyRelations(doc)).toBe(false)
  })

  it('leaves a document without a signing key as it is', () => {
    const doc = v1Document()
    doc.assertionMethod = []

    expect(alignSigningKeyRelations(doc)).toBe(false)
    expect(doc.authentication).toEqual([UPDATE_KEY])
  })
})

describe('removeUnservedLinkedVpServices', () => {
  const vtcUrl = `${PUBLIC_URL}/vt/schemas-service-vtc-vp.json`
  const vtjscUrl = `${PUBLIC_URL}/vt/schemas-12-vtjsc-vp.json`
  const options = {
    publicApiBaseUrl: PUBLIC_URL,
    vtc: { 'https://ecosystem.example/vt/schemas-14-jsc.json': { verifiablePresentation: { id: vtcUrl } } },
    jsc: { 'vpr:verana:test:cs:12': { verifiablePresentation: { id: vtjscUrl } } },
  }

  it('removes the v1 services and keeps the ones the agent serves', () => {
    const doc = new DidDocument({
      id: DID,
      service: [
        linkedVp('whois', `${PUBLIC_URL}/vt/schemas-service-c-vp.json`),
        linkedVp('vpr-schemas-service-c-vp', `${PUBLIC_URL}/vt/schemas-service-c-vp.json`),
        new DidDocumentService({ id: `${DID}#files`, type: 'relativeRef', serviceEndpoint: PUBLIC_URL }),
        linkedVp('vpr-schemas-service-vtc-vp', vtcUrl),
        linkedVp('vpr-schemas-12-vtjsc-vp', vtjscUrl),
      ],
    })

    expect(removeUnservedLinkedVpServices(doc, options)).toEqual([
      `${DID}#whois`,
      `${DID}#vpr-schemas-service-c-vp`,
    ])
    expect(doc.service?.map(service => service.id)).toEqual([
      `${DID}#files`,
      `${DID}#vpr-schemas-service-vtc-vp`,
      `${DID}#vpr-schemas-12-vtjsc-vp`,
    ])
  })

  it('keeps a #whois that points at a served presentation', () => {
    const doc = new DidDocument({ id: DID, service: [linkedVp('whois', vtcUrl)] })

    expect(removeUnservedLinkedVpServices(doc, options)).toEqual([])
    expect(doc.service).toHaveLength(1)
  })

  it('removes a service with no stored presentation, or one stored under the other kind', () => {
    const doc = new DidDocument({
      id: DID,
      service: [
        linkedVp('vpr-schemas-9-vtc-vp', `${PUBLIC_URL}/vt/schemas-9-vtc-vp.json`),
        linkedVp('elsewhere', 'https://other.example/vt/schemas-service-vtc-vp.json'),
      ],
    })

    expect(
      removeUnservedLinkedVpServices(doc, { publicApiBaseUrl: PUBLIC_URL, jsc: options.vtc }),
    ).toHaveLength(2)
    expect(doc.service).toEqual([])
  })
})
