import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsBoolean, ValidateIf } from 'class-validator'

export class CreateCredentialTypeDto {
  @ApiProperty({
    description:
      'Name. Used together with version to identify the credential type. Required if relatedJsonSchemaCredentialId is not provided.',
    example: 'myCredentialType',
    required: false,
  })
  @ValidateIf(o => !o.relatedJsonSchemaCredentialId)
  @IsString()
  @IsNotEmpty()
  name?: string

  @ApiProperty({
    description:
      'Version. Used together with name to identify the credential type. Required if relatedJsonSchemaCredentialId is not provided.',
    example: '1.0',
    required: false,
  })
  @ValidateIf(o => !o.relatedJsonSchemaCredentialId)
  @IsString()
  @IsNotEmpty()
  version?: string

  @ApiProperty({
    description:
      'Schema attributes. Only in case you want to create a new schema without providing a relatedJsonSchemaCredentialId',
    example: `['name', 'age']`,
  })
  @IsOptional()
  @IsNotEmpty()
  attributes?: string[]

  @ApiProperty({
    description: 'Base AnonCreds schema id in case you want to.',
    example: 'did:web:issuer#anoncreds?relativeRef=/schema/1234',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  schemaId?: string

  @ApiProperty({
    description:
      'Base Verifiable Trust JSON Schema Credential the credential type is based on. Required when issuerDid is provided.',
    example: 'https://example.2060.io/vt/schemas-example-service-jsc.json',
  })
  @ValidateIf(o => !!o.issuerDid || !!o.relatedJsonSchemaCredentialId)
  @IsString()
  @IsNotEmpty()
  relatedJsonSchemaCredentialId?: string

  @ApiProperty({
    description:
      'DID of the schema issuer. Used to fetch an existing AnonCreds schema from an external agent. Requires relatedJsonSchemaCredentialId.',
    example: 'did:web:issuer',
  })
  @ValidateIf(o => !!o.issuerDid)
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  issuerDid?: string

  @ApiProperty({
    description:
      'Indicates whether to enable credential revocation support. If enabled, it allows revocation of issued credentials.',
    example: true,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @IsNotEmpty()
  supportRevocation: boolean = false
}
