import { DidDocument } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { findDidCommVerificationMethodId } from '../src/did/didcommVerificationMethod'

const DID = 'did:webvh:QmScid:agent.example'
const UPDATE_KEY = 'z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'
const DIDCOMM_KEY = 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const KEY_AGREEMENT_KEY = 'z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'

function document(json: Record<string, unknown>): DidDocument {
  return DidDocument.fromJSON({ id: DID, ...json })
}

function webvhDocument(
  didCommType: 'Ed25519VerificationKey2020' | 'Multikey',
  { nominate = true }: { nominate?: boolean } = {},
): DidDocument {
  return document({
    verificationMethod: [
      {
        id: `${DID}#${UPDATE_KEY.slice(-8)}`,
        type: 'Multikey',
        controller: DID,
        publicKeyMultibase: UPDATE_KEY,
      },
      {
        id: `${DID}#${DIDCOMM_KEY}`,
        type: didCommType,
        controller: DID,
        publicKeyMultibase: DIDCOMM_KEY,
      },
      {
        id: `${DID}#key-agreement-1`,
        type: 'Multikey',
        controller: DID,
        publicKeyMultibase: KEY_AGREEMENT_KEY,
      },
    ],
    ...(nominate
      ? {
          authentication: [`${DID}#${DIDCOMM_KEY}`],
          assertionMethod: [`${DID}#${DIDCOMM_KEY}`],
        }
      : {}),
    keyAgreement: [`${DID}#key-agreement-1`],
  })
}

describe('findDidCommVerificationMethodId', () => {
  it('skips the webvh update key the registrar left first in verificationMethod', () => {
    expect(findDidCommVerificationMethodId(webvhDocument('Ed25519VerificationKey2020'))).toBe(
      `${DID}#${DIDCOMM_KEY}`,
    )
  })

  it('skips the webvh update key when the DIDComm key is published as a Multikey too', () => {
    expect(findDidCommVerificationMethodId(webvhDocument('Multikey'))).toBe(`${DID}#${DIDCOMM_KEY}`)
  })

  it('returns undefined for a webvh record that nominates nothing rather than guessing the update key', () => {
    expect(findDidCommVerificationMethodId(webvhDocument('Multikey', { nominate: false }))).toBeUndefined()
  })

  it('keeps a nominated Multikey over an Ed25519VerificationKey2020 method nobody nominates', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#didcomm`, type: 'Multikey', controller: DID, publicKeyMultibase: DIDCOMM_KEY },
        {
          id: `${DID}#unused`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: UPDATE_KEY,
        },
      ],
      authentication: [`${DID}#didcomm`],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBe(`${DID}#didcomm`)
  })

  it('prefers Ed25519VerificationKey2020 among the nominated entries', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#multikey`, type: 'Multikey', controller: DID, publicKeyMultibase: UPDATE_KEY },
        {
          id: `${DID}#ed25519`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: DIDCOMM_KEY,
        },
      ],
      authentication: [`${DID}#multikey`],
      assertionMethod: [`${DID}#ed25519`],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBe(`${DID}#ed25519`)
  })

  it('reads a verification method the relationship embeds instead of referencing', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#update`, type: 'Multikey', controller: DID, publicKeyMultibase: UPDATE_KEY },
      ],
      authentication: [
        {
          id: `${DID}#embedded`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: DIDCOMM_KEY,
        },
      ],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBe(`${DID}#embedded`)
  })

  it('returns undefined when the document nominates no Ed25519 method', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#update`, type: 'Multikey', controller: DID, publicKeyMultibase: UPDATE_KEY },
      ],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBeUndefined()
  })

  it('returns undefined when the document carries no Ed25519 method', () => {
    const didDocument = document({
      verificationMethod: [
        {
          id: `${DID}#p256`,
          type: 'JsonWebKey2020',
          controller: DID,
          publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
        },
      ],
      authentication: [`${DID}#p256`],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBeUndefined()
  })
})
