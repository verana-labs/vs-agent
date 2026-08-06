import { describe, expect, it } from 'vitest'

import { trustedCertificatesForVerification } from '../src/trust/CertificateTrust'
import type { OpenId4VcPluginOptions } from '../src/types'

const options = (keyAttestationCertificates?: string[]): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {
    id: 'issuer',
    displayName: 'Example Issuer',
    signing: { development: { enabled: true, commonName: 'Example Issuer' } },
    ...(keyAttestationCertificates ? { keyAttestationCertificates } : {}),
  },
  credentialConfigurations: [],
  verifierPolicies: [],
})

describe('key attestation trust', () => {
  it('anchors a key attestation on the configured roots', () => {
    const trusted = trustedCertificatesForVerification(options(['wallet-provider-root']), {
      type: 'openId4VciKeyAttestation',
      certificateChain: [],
    })

    expect(trusted).toEqual(['wallet-provider-root'])
  })

  it('refuses a key attestation when no root is configured', () => {
    const trusted = trustedCertificatesForVerification(options(), {
      type: 'openId4VciKeyAttestation',
      certificateChain: [],
    })

    expect(trusted).toBeUndefined()
  })
})
