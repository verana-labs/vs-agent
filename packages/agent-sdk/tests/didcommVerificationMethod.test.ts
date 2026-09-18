import { DidDocument } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import { findDidCommVerificationMethodId } from '../src/did/didcommVerificationMethod'

const DID = 'did:webvh:QmScid:agent.example'
const DIDCOMM_KEY = 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const OTHER_KEY = 'z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'

function document(json: Record<string, unknown>): DidDocument {
  return DidDocument.fromJSON({ id: DID, ...json })
}

describe('findDidCommVerificationMethodId', () => {
  it('keeps the Multikey the document nominates for authentication over a later Ed25519VerificationKey2020 method', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#didcomm`, type: 'Multikey', controller: DID, publicKeyMultibase: DIDCOMM_KEY },
        {
          id: 'did:web:agent.example#openid4vc-parallel-web',
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: DIDCOMM_KEY,
        },
      ],
      authentication: [`${DID}#didcomm`, 'did:web:agent.example#openid4vc-parallel-web'],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBe(`${DID}#didcomm`)
  })

  it('prefers an Ed25519VerificationKey2020 method when the document nominates nothing', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#multikey`, type: 'Multikey', controller: DID, publicKeyMultibase: OTHER_KEY },
        {
          id: `${DID}#ed25519`,
          type: 'Ed25519VerificationKey2020',
          controller: DID,
          publicKeyMultibase: DIDCOMM_KEY,
        },
      ],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBe(`${DID}#ed25519`)
  })

  it('falls back to an Ed25519 Multikey', () => {
    const didDocument = document({
      verificationMethod: [
        { id: `${DID}#multikey`, type: 'Multikey', controller: DID, publicKeyMultibase: DIDCOMM_KEY },
      ],
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBe(`${DID}#multikey`)
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
    })

    expect(findDidCommVerificationMethodId(didDocument)).toBeUndefined()
  })
})
