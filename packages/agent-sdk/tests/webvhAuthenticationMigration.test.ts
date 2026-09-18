import { describe, expect, it } from 'vitest'

import { migratedAuthentication, needsAuthenticationMigration } from '../src/did/webvhAuthentication'

const DID = 'did:webvh:QmScid:agent.example'
const DIDCOMM_KEY_ID = `${DID}#didcomm`
const UPDATE_KEY_ID = `${DID}#update-key`
const PLUGIN_VERIFIER_ID = `${DID}#openid4vc-development-verifier`
const PLUGIN_ISSUER_ID = `${DID}#openid4vc-development-issuer`
const PARALLEL_WEB_ID = 'did:web:agent.example#openid4vc-parallel-web'

describe('needsAuthenticationMigration', () => {
  it('does not trigger on a document holding only the DIDComm key and OpenID4VC keys', () => {
    expect(needsAuthenticationMigration([DIDCOMM_KEY_ID, PLUGIN_VERIFIER_ID], DIDCOMM_KEY_ID)).toBe(false)
  })

  it('does not trigger on the parallel did:web OpenID4VC key', () => {
    expect(needsAuthenticationMigration([DIDCOMM_KEY_ID, PARALLEL_WEB_ID], DIDCOMM_KEY_ID)).toBe(false)
  })

  it('triggers when the didwebvh-ts update key is still present', () => {
    expect(
      needsAuthenticationMigration([DIDCOMM_KEY_ID, UPDATE_KEY_ID, PLUGIN_VERIFIER_ID], DIDCOMM_KEY_ID),
    ).toBe(true)
  })

  it('ignores OpenID4VC keys given in embedded verification method form', () => {
    const embedded = {
      id: PLUGIN_ISSUER_ID,
      type: 'Multikey',
      controller: DID,
      publicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    }

    expect(needsAuthenticationMigration([DIDCOMM_KEY_ID, embedded], DIDCOMM_KEY_ID)).toBe(false)
  })
})

describe('migratedAuthentication', () => {
  it('drops the update key and keeps the OpenID4VC key', () => {
    expect(
      migratedAuthentication([DIDCOMM_KEY_ID, UPDATE_KEY_ID, PLUGIN_VERIFIER_ID], DIDCOMM_KEY_ID),
    ).toEqual([DIDCOMM_KEY_ID, PLUGIN_VERIFIER_ID])
  })

  it('keeps every OpenID4VC key in its existing form', () => {
    const embedded = {
      id: PLUGIN_ISSUER_ID,
      type: 'Multikey',
      controller: DID,
      publicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    }

    expect(
      migratedAuthentication([DIDCOMM_KEY_ID, UPDATE_KEY_ID, embedded, PARALLEL_WEB_ID], DIDCOMM_KEY_ID),
    ).toEqual([DIDCOMM_KEY_ID, embedded, PARALLEL_WEB_ID])
  })

  it('leaves a document that carries only the DIDComm key untouched', () => {
    expect(migratedAuthentication([DIDCOMM_KEY_ID], DIDCOMM_KEY_ID)).toEqual([DIDCOMM_KEY_ID])
  })
})
