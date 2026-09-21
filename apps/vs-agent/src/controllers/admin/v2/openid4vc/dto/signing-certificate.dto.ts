import type { SigningRole } from '@verana-labs/vs-agent-plugin-openid4vc'

import { ApiProperty } from '@nestjs/swagger'

export class Openid4vcSigningCertificateDto {
  @ApiProperty({
    enum: ['issuer', 'verifier'],
    description: 'The capability that signs with this certificate',
  })
  role!: SigningRole

  @ApiProperty({ description: 'True when the agent generated the certificate itself (development signing)' })
  development!: boolean

  @ApiProperty({
    description:
      'SHA-256 fingerprint of the leaf, the pin format of trust.developmentCertificateFingerprints',
    example: `SHA256:${'0'.repeat(64)}`,
  })
  fingerprint!: string

  @ApiProperty({ type: [String], description: 'Certificate chain, base64 DER, leaf first' })
  certificateChain!: string[]
}
