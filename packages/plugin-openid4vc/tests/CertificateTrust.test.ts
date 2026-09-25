import type { OpenId4VcPluginOptions } from '../src/types'

import { beforeAll, describe, expect, it } from 'vitest'

import { certificateFingerprint, trustedCertificatesForVerification } from '../src/trust/CertificateTrust'

import { createCertificateFixtures } from './helpers/certificates'

describe('CertificateTrust', () => {
  let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

  beforeAll(async () => {
    fixtures = await createCertificateFixtures()
  })

  it('encodes certificate fingerprints without certificate or key material', () => {
    expect(certificateFingerprint(fixtures.leaf)).toMatch(/^SHA256:[0-9a-f]{64}$/)
  })
})

const options = (keyAttestationCertificates?: string[]): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: { ...(keyAttestationCertificates ? { keyAttestationCertificates } : {}) },
  credentialConfigurations: [],
})

describe('key attestation trust', () => {
  it('anchors a key attestation on the configured roots', () => {
    const trusted = trustedCertificatesForVerification(
      options(['wallet-provider-root']),
      'openId4VciKeyAttestation',
    )

    expect(trusted).toEqual(['wallet-provider-root'])
  })

  it('refuses a key attestation when no root is configured', () => {
    const trusted = trustedCertificatesForVerification(options(), 'openId4VciKeyAttestation')

    expect(trusted).toBeUndefined()
  })
})
