import type { OpenId4VcPluginOptions } from '../types'
import type { X509Certificate } from '@credo-ts/core'

import { createHash } from 'node:crypto'

export function trustedCertificatesForVerification(
  options: OpenId4VcPluginOptions,
  verification: { type: string; certificateChain: X509Certificate[] },
): string[] | undefined {
  if (verification.type === 'credential') {
    if (options.trust?.credentialIssuerCertificates.length) {
      return options.trust.credentialIssuerCertificates
    }

    const leaf = verification.certificateChain[0]
    const fingerprint = leaf ? certificateFingerprint(leaf) : undefined
    return fingerprint && options.trust?.developmentCertificateFingerprints?.includes(fingerprint)
      ? [leaf.toString('base64')]
      : undefined
  }

  if (verification.type === 'oauth2ClientAttestation') {
    return options.issuer?.walletAttestationCertificates?.length
      ? options.issuer.walletAttestationCertificates
      : undefined
  }

  return undefined
}

export function certificateFingerprint(certificate: X509Certificate): string {
  const digest = createHash('sha256').update(certificate.rawCertificate).digest('hex')
  return `SHA256:${digest}`
}
