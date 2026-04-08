import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator'

/**
 * DTO used to request the issuance of a Verifiable Credential.
 */
export class RevokeCredentialRequestDto {
  @ApiProperty({
    description:
      'Format of credential to revoke: json-ld (for public entities) or "anoncreds" (for best privacy, usually for end-users)',
    example: 'jsonld',
    enum: ['jsonld', 'anoncreds'],
  })
  @IsString()
  @IsNotEmpty()
  format!: 'jsonld' | 'anoncreds'

  @ApiProperty({
    description:
      'ID of the Revocation Registry Definition where the credential status is registered. Mandatory for AnonCreds credentials',
    example: 'https://example.org/schemas/example-service.json',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  anoncredsRevocationRegistryDefinitionId?: string

  @ApiProperty({
    description: 'Index of the credential in the revocation registry. Mandatory for AnonCreds credentials',
    example: 123,
  })
  @IsNumber()
  @IsOptional()
  @IsNotEmpty()
  anoncredsRevocationRegistryIndex?: number
}
