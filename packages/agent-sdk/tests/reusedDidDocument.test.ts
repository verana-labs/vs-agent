import { DidDocument, DidDocumentService, VerificationMethod } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import {
  alignSigningKeyRelations,
  didWebvhUpdateKeys,
  findSigningVerificationMethodId,
  removeUnservedLinkedVpServices,
} from '../src/did/reusedDidDocument'

const DID = 'did:webvh:QmScid:agent.example'
const PUBLIC_URL = 'https://agent.example'
const UPDATE_KEY = `${DID}#mv1jHjTJ`
const SIGNING_KEY = `${DID}#z6Mkp3uGQYVyfKWvomdv8ykrwNxBv2vVRLadKZ1xNE6hC4W6`

const UPDATE_KEY_MULTIBASE = 'z6Mkn3EhsVVM68RqmD1KVCqQQn27S2oNFSmYgG5Jmv1jHjTJ'
const OID4VC_ISSUER_KEY = `${DID}#openid4vc-development-issuer`
const OID4VC_VERIFIER_KEY = `${DID}#openid4vc-development-verifier`

const ed25519 = (id: string, publicKeyMultibase?: string) =>
  new VerificationMethod({ id, controller: DID, type: 'Ed25519VerificationKey2020', publicKeyMultibase })

const linkedVp = (fragment: string, serviceEndpoint: string) =>
  new DidDocumentService({ id: `${DID}#${fragment}`, type: 'LinkedVerifiablePresentation', serviceEndpoint })

/** The layout v1 leaves behind: the update key first and under `authentication`. */
function v1Document() {
  return new DidDocument({
    id: DID,
    verificationMethod: [
      ed25519(UPDATE_KEY, UPDATE_KEY_MULTIBASE),
      ed25519(SIGNING_KEY, SIGNING_KEY.split('#')[1]),
    ],
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
  const updateKeys = [UPDATE_KEY_MULTIBASE]

  it('replaces the update key with the signing key under authentication', () => {
    const doc = v1Document()

    expect(alignSigningKeyRelations(doc, updateKeys)).toBe(true)
    expect(doc.authentication).toEqual([SIGNING_KEY])
    expect(doc.assertionMethod).toEqual([SIGNING_KEY])
  })

  it('removes the update key from assertionMethod', () => {
    const doc = v1Document()
    doc.authentication = [SIGNING_KEY]
    doc.assertionMethod = [SIGNING_KEY, UPDATE_KEY]

    expect(alignSigningKeyRelations(doc, updateKeys)).toBe(true)
    expect(doc.assertionMethod).toEqual([SIGNING_KEY])
  })

  it('keeps the OpenID4VC keys and reports no change once the document is aligned', () => {
    const doc = v1Document()
    doc.authentication = [UPDATE_KEY, OID4VC_VERIFIER_KEY]
    doc.assertionMethod = [SIGNING_KEY, OID4VC_ISSUER_KEY]

    expect(alignSigningKeyRelations(doc, updateKeys)).toBe(true)
    expect(doc.authentication).toEqual([SIGNING_KEY, OID4VC_VERIFIER_KEY])
    expect(doc.assertionMethod).toEqual([SIGNING_KEY, OID4VC_ISSUER_KEY])

    expect(alignSigningKeyRelations(doc, updateKeys)).toBe(false)
  })

  it('adds the signing key and keeps the other keys when the log names no update key', () => {
    const doc = v1Document()

    expect(alignSigningKeyRelations(doc)).toBe(true)
    expect(doc.authentication).toEqual([SIGNING_KEY, UPDATE_KEY])
  })

  it('never removes the signing key, even when the log lists it as an update key', () => {
    const doc = v1Document()
    doc.authentication = [SIGNING_KEY]

    expect(alignSigningKeyRelations(doc, [SIGNING_KEY.split('#')[1]])).toBe(false)
    expect(doc.assertionMethod).toEqual([SIGNING_KEY])
  })

  it('reports no change for the layout of a newly created DID', () => {
    const doc = v1Document()
    doc.authentication = [SIGNING_KEY]

    expect(alignSigningKeyRelations(doc, updateKeys)).toBe(false)
  })

  it('leaves a document without a signing key as it is', () => {
    const doc = v1Document()
    doc.assertionMethod = []

    expect(alignSigningKeyRelations(doc, updateKeys)).toBe(false)
    expect(doc.authentication).toEqual([UPDATE_KEY])
  })
})

describe('didWebvhUpdateKeys', () => {
  it('collects the update keys of every log entry once', () => {
    const log = [
      { parameters: { updateKeys: ['z6MkFirst'] } },
      { parameters: {} },
      { parameters: { updateKeys: ['z6MkFirst', 'z6MkRotated'] } },
    ]

    expect(didWebvhUpdateKeys(log)).toEqual(['z6MkFirst', 'z6MkRotated'])
  })

  it('returns nothing for a record without a log', () => {
    expect(didWebvhUpdateKeys(undefined)).toEqual([])
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
