import type { GetTrustedIssuersForVerification, VerificationSigner } from '@credo-ts/core'
import type { OpenId4VcVerificationTypes } from '@credo-ts/openid4vc'

import { assertCredentialExpires } from '../services/presentationVerification'

/**
 * What credo may trust as the signer of a presented credential, step 1 of
 * [VSA-VTI-FLOW-VERIFY-OID]. The DID Document binds the issuer key (step 4), not a certificate
 * chain, so the leaf certificate the wallet presented is the one anchor credo needs for `x5c`; a
 * DID signer needs none. Every other verification falls through to the next layer.
 */
export const trustedIssuersForPresentation: GetTrustedIssuersForVerification<
  VerificationSigner,
  OpenId4VcVerificationTypes
> = async (_agentContext, { signer, verification }) => {
  if (verification.type !== 'openId4VpCredential') return undefined
  // credo accepts an SD-JWT VC without `exp`; the spec does not
  assertCredentialExpires(verification.credential)
  if (signer.method !== 'x509') return undefined
  return {
    trustedIssuers: [{ method: 'x509', issuance: [signer.certificateChain[0].toString('base64')] }],
  }
}
