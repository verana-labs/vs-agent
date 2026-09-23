import type { OpenId4VcPluginOptions } from '../types'
import type { X509Certificate } from '@credo-ts/core'

import { createHash } from 'node:crypto'

export function trustedCertificatesForVerification(
  options: OpenId4VcPluginOptions,
  verificationType: string,
): string[] | undefined {
  if (verificationType === 'oauth2ClientAttestation') {
    return options.issuer?.walletAttestationCertificates?.length
      ? options.issuer.walletAttestationCertificates
      : undefined
  }

  if (verificationType === 'openId4VciKeyAttestation') {
    return options.issuer?.keyAttestationCertificates?.length
      ? options.issuer.keyAttestationCertificates
      : undefined
  }

  return undefined
}

export function certificateFingerprint(certificate: X509Certificate): string {
  const digest = createHash('sha256').update(certificate.rawCertificate).digest('hex')
  return `SHA256:${digest}`
}
