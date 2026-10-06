import { describe, expect, it } from 'vitest'

import { trustedIssuersForPresentation } from '../src/trust/presentedIssuer'

const leaf = { toString: () => 'leaf-base64' }
const credential = { claimFormat: 'dc+sd-jwt', payload: { exp: 4_102_444_800 } }

describe('trustedIssuersForPresentation', () => {
  it('trusts the leaf certificate a wallet presented as the issuer of an OpenID4VP credential', async () => {
    await expect(
      trustedIssuersForPresentation({} as never, {
        signer: { method: 'x509', certificateChain: [leaf, { toString: () => 'root' }] as never },
        verification: {
          type: 'openId4VpCredential',
          credential,
          openId4VcVerificationSessionRecord: {},
        } as never,
      }),
    ).resolves.toEqual({ trustedIssuers: [{ method: 'x509', issuance: ['leaf-base64'] }] })
  })

  it('names no trusted issuer for a DID signer, whose key the DID Document binds', async () => {
    await expect(
      trustedIssuersForPresentation({} as never, {
        signer: { method: 'did', didUrl: 'did:web:issuer.example#key-1' },
        verification: {
          type: 'openId4VpCredential',
          credential,
          openId4VcVerificationSessionRecord: {},
        } as never,
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses an OpenID4VP credential without a numeric exp', async () => {
    await expect(
      trustedIssuersForPresentation({} as never, {
        signer: { method: 'x509', certificateChain: [leaf] as never },
        verification: {
          type: 'openId4VpCredential',
          credential: { claimFormat: 'dc+sd-jwt', payload: {} },
          openId4VcVerificationSessionRecord: {},
        } as never,
      }),
    ).rejects.toThrow("no numeric 'exp' claim")
  })

  it('falls through for every other verification', async () => {
    await expect(
      trustedIssuersForPresentation({} as never, {
        signer: { method: 'x509', certificateChain: [leaf] as never },
        verification: { type: 'oauth2ClientAttestation' } as never,
      }),
    ).resolves.toBeUndefined()
  })
})
