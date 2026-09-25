import type { SigningRole } from '../../services/CertificateService'

import { ApiProperty } from '@nestjs/swagger'

/** One entry of [VSA-ADM-OID-CS] listSigningCertificates. */
export class OpenId4VcSigningCertificateDto {
  @ApiProperty({
    enum: ['issuer', 'verifier'],
    description: 'The capability that signs with this certificate',
  })
  role!: SigningRole

  @ApiProperty({ description: 'True when the agent generated the certificate itself (development signing)' })
  development!: boolean

  @ApiProperty({
    description: 'SHA-256 fingerprint of the leaf, for an operator to pin it on a peer verifier',
    example: `SHA256:${'0'.repeat(64)}`,
  })
  fingerprint!: string

  @ApiProperty({ type: [String], description: 'Certificate chain, base64 DER, leaf first' })
  certificateChain!: string[]
}
