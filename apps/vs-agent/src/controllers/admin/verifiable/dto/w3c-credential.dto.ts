import { W3cJsonLdVerifiableCredential } from '@credo-ts/core'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, ValidateNested } from 'class-validator'

export class W3cCredentialDto {
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => W3cJsonLdVerifiableCredential)
  credential!: W3cJsonLdVerifiableCredential

  @ApiProperty({
    description:
      'The short identifier of the credential schema (used to build the full schema URL). ' +
      'Do not include the base URL or file extension.',
    example: 'example-service',
  })
  @IsString()
  @Matches(/^[a-z0-9\-]+$/i, {
    message: 'schemaBaseId must contain only letters, numbers, or hyphens.',
  })
  schemaBaseId!: string
}
