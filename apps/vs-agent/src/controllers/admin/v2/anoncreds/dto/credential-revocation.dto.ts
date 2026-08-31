import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator'

/**
 * Request body of [VSA-ADM-AC-CR-REVOKE] revokeCredential
 */
export class RevokeCredentialBodyDto {
  @ApiProperty({
    description: 'Revocation registry definition the credential is registered in',
    example:
      'did:webvh:QmQmBtfboNvDrs5SDaDDK3VmUq6ji4yUgLnYaMFo8furUe:2060.io/resources/zQmVXd5K7oTJGiXR88vzKoubQWbNxM5U8s4xBkRtCTgfmHq',
  })
  @IsString()
  @IsNotEmpty()
  revocationRegistryDefinitionId!: string

  @ApiProperty({
    description:
      'Index of the credential in the revocation registry. The first credential of a registry lives at index 0, ' +
      'and the last one at `maxCredNum - 1`.',
    example: 0,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  revocationRegistryIndex!: number
}

/**
 * Confirmation that [VSA-ADM-AC-CR-REVOKE] revokeCredential returns
 */
export class RevokeCredentialResponseDto {
  @ApiProperty({ description: 'Revocation registry definition the credential was revoked in' })
  revocationRegistryDefinitionId!: string

  @ApiProperty({ description: 'Index of the revoked credential in the registry' })
  revocationRegistryIndex!: number

  @ApiProperty({
    description: 'Timestamp of the published revocation status list that carries the revocation',
    example: '2026-08-28T10:15:30.000Z',
  })
  revokedAt!: string
}
