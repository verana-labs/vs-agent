import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

/**
 * Data Transfer Object JsonSchemaCredential.
 */
export class JsonSchemaCredentialDto {
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

  @ApiProperty({
    description:
      'URL to the JSON Schema definition. ' +
      'If omitted, it will be treated as a self essential schema (' +
      '`schemas-example-service.json`).',
    example: 'vpr:verana:vna-testnet-1:cs:12345678',
  })
  @IsString()
  @Matches(/^(https?:\/\/[^\s]+|vpr:[^\s]+)$/i, {
    message: 'jsonSchemaRef must be either a valid HTTP URL or a vpr reference',
  })
  jsonSchemaRef!: string
}
