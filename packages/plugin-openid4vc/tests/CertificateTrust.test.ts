import type { OpenId4VcPluginOptions } from '../src/types'
import type { X509Certificate } from '@credo-ts/core'

import { beforeAll, describe, expect, it } from 'vitest'

import { certificateFingerprint, trustedCertificatesForVerification } from '../src/trust/CertificateTrust'

import { createCertificateFixtures } from './helpers/certificates'

describe('CertificateTrust', () => {
  let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

  beforeAll(async () => {
    fixtures = await createCertificateFixtures()
  })

  it('never returns the peer-provided chain as a trust anchor', () => {
    const options = validOptions(fixtures.root)
    const attackerChain = [fixtures.attacker]

    const anchors = trustedCertificatesForVerification(options, {
      type: 'credential',
      certificateChain: attackerChain,
    })

    expect(anchors).toEqual(options.trust?.credentialIssuerCertificates)
    expect(anchors).not.toEqual(attackerChain.map(certificate => certificate.toString('base64')))
  })

  it('returns no wallet attestation anchors when the feature is not configured', () => {
    expect(
      trustedCertificatesForVerification(validOptions(fixtures.root), {
        type: 'oauth2ClientAttestation',
        certificateChain: [fixtures.attacker],
      }),
    ).toBeUndefined()
  })

  it('returns only configured wallet attestation anchors', () => {
    const options = validOptions(fixtures.root)
    options.issuer!.walletAttestationCertificates = [fixtures.intermediate.toString('base64')]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'oauth2ClientAttestation',
        certificateChain: [fixtures.attacker],
      }),
    ).toEqual(options.issuer!.walletAttestationCertificates)
  })

  it('accepts a self-signed development leaf only through its exact SHA-256 fingerprint', () => {
    const options = validOptions(fixtures.root)
    options.trust!.credentialIssuerCertificates = []
    options.trust!.developmentCertificateFingerprints = [certificateFingerprint(fixtures.attacker)]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'credential',
        certificateChain: [fixtures.attacker],
      }),
    ).toEqual([fixtures.attacker.toString('base64')])
  })

  it('rejects a different self-signed development fingerprint', () => {
    const options = validOptions(fixtures.root)
    options.trust!.credentialIssuerCertificates = []
    options.trust!.developmentCertificateFingerprints = [certificateFingerprint(fixtures.root)]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'credential',
        certificateChain: [fixtures.attacker],
      }),
    ).toBeUndefined()
  })

  it('uses configured credential roots before development pins', () => {
    const options = validOptions(fixtures.root)
    options.trust!.developmentCertificateFingerprints = [certificateFingerprint(fixtures.attacker)]

    expect(
      trustedCertificatesForVerification(options, {
        type: 'credential',
        certificateChain: [fixtures.attacker],
      }),
    ).toEqual(options.trust!.credentialIssuerCertificates)
  })

  it('returns no anchors for unrelated verification categories', () => {
    expect(
      trustedCertificatesForVerification(validOptions(fixtures.root), {
        type: 'oauth2SecuredAuthorizationRequest',
        certificateChain: [fixtures.attacker],
      }),
    ).toBeUndefined()
  })

  it('encodes certificate fingerprints without certificate or key material', () => {
    expect(certificateFingerprint(fixtures.leaf)).toMatch(/^SHA256:[0-9a-f]{64}$/)
  })
})

function validOptions(root: X509Certificate): OpenId4VcPluginOptions {
  return {
    publicApiBaseUrl: 'https://agent.example',
    issuer: {
      id: 'issuer',
      displayName: 'Issuer',
      signing: { development: { enabled: true, commonName: 'Issuer' } },
    },
    trust: {
      resolverUrl: 'https://resolver.example',
      timeoutMs: 5_000,
      credentialIssuerCertificates: [root.toString('base64')],
    },
    credentialConfigurations: [],
    verifierPolicies: [],
  }
}
