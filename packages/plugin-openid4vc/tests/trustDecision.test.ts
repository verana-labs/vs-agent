import type { PresentationTrustDependencies } from '../src/trust/trustDecision'
import type { SdJwtVc } from '@credo-ts/core'
import type { DidTrustResolution } from '@verana-labs/vs-agent-sdk'

import { ClaimFormat, Kms } from '@credo-ts/core'
import { describe, expect, it } from 'vitest'

import {
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  digestOfBytes,
  TrustResolutionOutcome,
} from '@verana-labs/vs-agent-sdk'

import { decidePresentationTrust } from '../src/trust/trustDecision'

import { didDocumentWithKey } from './helpers/fakeDidResolver'

const ISSUER_DID = 'did:web:issuer.example'
const ISSUER_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
  y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
}
const OTHER_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'WbRlIAsgZTf6jHxLVjt2YUwUj3ZqI-1F3kf4IsH0nL4',
  y: 'jpr7bKngfOEE_C5G3BgnvcVFyoc-SIAdkeV7B_OPrbA',
}
const VCT = 'https://credentials.example/vt/vct/1'
const VTJSC_ID = 'https://credentials.example/vt/employee.json'
const TYPE_METADATA = Buffer.from(JSON.stringify({ vct: VCT, relatedJsonSchemaCredentialId: VTJSC_ID }))
const REQUEST = { jsonSchemaCredentialId: VTJSC_ID, credentialSchemaId: 1 }

const trustResolution = (trusted: boolean): DidTrustResolution => ({
  trusted,
  verified: trusted,
  outcome: trusted ? TrustResolutionOutcome.VERIFIED : TrustResolutionOutcome.NOT_TRUSTED,
  source: 'fresh',
})

const issuerKey = Kms.PublicJwk.fromUnknown(ISSUER_JWK)
const leaf = { publicJwk: issuerKey, sanUriNames: [ISSUER_DID] }

/** A credential as credo hands it over after step 1, signed with the fixture leaf. */
function credential(
  overrides: Partial<Record<'issuer' | 'payload' | 'prettyClaims', unknown>> = {},
): SdJwtVc {
  const payload = {
    iss: 'https://issuer.example',
    vct: VCT,
    'vct#integrity': digestOfBytes(TYPE_METADATA),
    exp: 4_102_444_800,
    cnf: { jwk: OTHER_JWK },
  }
  return {
    claimFormat: ClaimFormat.SdJwtDc,
    issuer: { method: 'x5c', x5c: [leaf], issuer: 'https://issuer.example' },
    payload,
    prettyClaims: { ...payload, name: 'Ada Lovelace', role: 'engineer' },
    ...overrides,
  } as unknown as SdJwtVc
}

function dependencies(overrides: Partial<PresentationTrustDependencies> = {}): PresentationTrustDependencies {
  const didDocument = didDocumentWithKey(ISSUER_DID, ISSUER_JWK, ['assertionMethod'])
  return {
    agent: { dids: { resolve: async () => ({ didDocument, didResolutionMetadata: {} }) } } as never,
    readTypeMetadata: async () => TYPE_METADATA,
    resolveDidTrust: async () => trustResolution(true),
    assertAuthorized: async () => {},
    ...overrides,
  }
}

describe('decidePresentationTrust', () => {
  it('accepts a credential that passes every step, with the reads it ran as evidence', async () => {
    await expect(decidePresentationTrust(credential(), REQUEST, dependencies())).resolves.toEqual({
      cryptographicVerified: true,
      accepted: true,
      trust: {
        verdict: 'TRUSTED_AUTHORIZED',
        evidence: {
          did: ISSUER_DID,
          trustStatus: 'TRUSTED',
          jsonSchemaCredentialId: VTJSC_ID,
          authorized: true,
          queries: [
            `resolve ${ISSUER_DID}`,
            `GET ${VCT}`,
            `resolveDID ${ISSUER_DID}`,
            `listParticipants did=${ISSUER_DID} role=ISSUER schema_id=1`,
          ],
        },
      },
      credential: { vct: VCT, disclosedClaims: { name: 'Ada Lovelace', role: 'engineer' } },
    })
  })

  it('takes the issuer DID from iss when iss is a DID', async () => {
    const presented = credential({ payload: { ...credential().payload, iss: ISSUER_DID } })

    const decision = await decidePresentationTrust(presented, REQUEST, dependencies())

    expect(decision.trust?.evidence.did).toBe(ISSUER_DID)
    expect(decision.trust?.verdict).toBe('TRUSTED_AUTHORIZED')
  })

  it('binds a DID-signed credential through the verification method its didUrl names', async () => {
    const presented = credential({ issuer: { method: 'did', didUrl: `${ISSUER_DID}#key-1` } })

    const decision = await decidePresentationTrust(presented, REQUEST, dependencies())

    expect(decision.trust?.verdict).toBe('TRUSTED_AUTHORIZED')
  })

  it('answers UNTRUSTED for a credential that yields no issuer DID', async () => {
    const presented = credential({
      issuer: { method: 'x5c', x5c: [{ ...leaf, sanUriNames: [] }], issuer: 'https://issuer.example' },
    })

    const decision = await decidePresentationTrust(presented, REQUEST, dependencies())

    expect(decision.accepted).toBe(false)
    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { did: null, note: expect.stringContaining('no DID') },
    })
  })

  it('answers UNTRUSTED for an issuer DID of another method', async () => {
    const presented = credential({ payload: { ...credential().payload, iss: 'did:key:z6Mkabc' } })

    const decision = await decidePresentationTrust(presented, REQUEST, dependencies())

    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { did: 'did:key:z6Mkabc', note: expect.stringContaining('no did:web') },
    })
  })

  it('answers RESOLVER_UNAVAILABLE when the issuer DID does not resolve', async () => {
    const agent = { dids: { resolve: async () => ({ didResolutionMetadata: { error: 'notFound' } }) } }

    const decision = await decidePresentationTrust(
      credential(),
      REQUEST,
      dependencies({ agent: agent as never }),
    )

    expect(decision.trust).toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
      evidence: {
        queries: [`resolve ${ISSUER_DID}`],
        note: expect.stringContaining('could not be resolved'),
      },
    })
  })

  it('answers UNTRUSTED when the DID Document does not authorize the key under assertionMethod', async () => {
    const didDocument = didDocumentWithKey(ISSUER_DID, ISSUER_JWK, ['authentication'])
    const agent = { dids: { resolve: async () => ({ didDocument, didResolutionMetadata: {} }) } }

    const decision = await decidePresentationTrust(
      credential(),
      REQUEST,
      dependencies({ agent: agent as never }),
    )

    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { note: expect.stringContaining('assertionMethod') },
    })
  })

  it('answers UNTRUSTED for a credential without vct#integrity', async () => {
    const { 'vct#integrity': _integrity, ...payload } = credential().payload
    const presented = credential({ payload })

    const decision = await decidePresentationTrust(presented, REQUEST, dependencies())

    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { note: expect.stringContaining('vct#integrity') },
    })
  })

  it('answers UNTRUSTED when the served Type Metadata does not hash to vct#integrity', async () => {
    const readTypeMetadata = async () => Buffer.from(JSON.stringify({ vct: VCT, name: 'changed' }))

    const decision = await decidePresentationTrust(credential(), REQUEST, dependencies({ readTypeMetadata }))

    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { note: expect.stringContaining('does not hash') },
    })
  })

  it('answers UNTRUSTED when the Type Metadata names another VTJSC than the request', async () => {
    const document = Buffer.from(JSON.stringify({ vct: VCT, relatedJsonSchemaCredentialId: 'other' }))
    const presented = credential({
      payload: { ...credential().payload, 'vct#integrity': digestOfBytes(document) },
    })

    const decision = await decidePresentationTrust(
      presented,
      REQUEST,
      dependencies({ readTypeMetadata: async () => document }),
    )

    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { note: expect.stringContaining('names the VTJSC "other"') },
    })
  })

  it('answers RESOLVER_UNAVAILABLE when the Type Metadata cannot be read', async () => {
    const readTypeMetadata = async () => {
      throw new Error('ECONNREFUSED')
    }

    const decision = await decidePresentationTrust(credential(), REQUEST, dependencies({ readTypeMetadata }))

    expect(decision.trust).toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
      evidence: { note: expect.stringContaining('ECONNREFUSED') },
    })
  })

  it('answers UNTRUSTED when the trust resolution does not trust the issuer', async () => {
    const resolveDidTrust = async () => trustResolution(false)

    const decision = await decidePresentationTrust(credential(), REQUEST, dependencies({ resolveDidTrust }))

    expect(decision.trust).toMatchObject({
      verdict: 'UNTRUSTED',
      evidence: { trustStatus: 'UNTRUSTED', authorized: null },
    })
  })

  it('answers RESOLVER_UNAVAILABLE when the trust resolution fails', async () => {
    const resolveDidTrust = async () => {
      throw new Error('indexer down')
    }

    const decision = await decidePresentationTrust(credential(), REQUEST, dependencies({ resolveDidTrust }))

    expect(decision.trust).toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
      evidence: { trustStatus: null, note: expect.stringContaining('indexer down') },
    })
  })

  it('answers TRUSTED_NOT_AUTHORIZED for an issuer without an active ISSUER Participant', async () => {
    const assertAuthorized = async () => {
      throw new AnonCredsTrustError(AnonCredsTrustErrorReason.NotAuthorized, 'no active ISSUER Participant')
    }

    const decision = await decidePresentationTrust(credential(), REQUEST, dependencies({ assertAuthorized }))

    expect(decision.accepted).toBe(false)
    expect(decision.trust).toMatchObject({
      verdict: 'TRUSTED_NOT_AUTHORIZED',
      evidence: { trustStatus: 'TRUSTED', authorized: false, note: 'no active ISSUER Participant' },
    })
  })

  it('answers RESOLVER_UNAVAILABLE when the Participant check cannot run', async () => {
    const assertAuthorized = async () => {
      throw new AnonCredsTrustError(AnonCredsTrustErrorReason.Unavailable, 'the indexer did not answer')
    }

    const decision = await decidePresentationTrust(credential(), REQUEST, dependencies({ assertAuthorized }))

    expect(decision.trust).toMatchObject({
      verdict: 'RESOLVER_UNAVAILABLE',
      evidence: { trustStatus: 'TRUSTED', authorized: null, note: 'the indexer did not answer' },
    })
  })
})
