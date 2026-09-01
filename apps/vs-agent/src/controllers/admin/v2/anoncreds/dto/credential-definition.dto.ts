import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

import { PageDto } from '../../../../../common'

/**
 * The request body of [VSA-ADM-AC-CD-CREATE].
 *
 * The specification permits only these two fields. A Verifiable Trust JSON Schema Credential
 * governs each credential definition. The agent reads the schema from that credential. The
 * caller does not send the schema.
 */
export class CreateCredentialDefinitionDto {
  @ApiProperty({
    description: 'URL of the Verifiable Trust JSON Schema Credential that governs the credential definition.',
    example: 'https://example.2060.io/vt/schemas-example-service-jsc.json',
  })
  @IsString()
  @IsNotEmpty()
  relatedJsonSchemaCredentialId!: string

  @ApiPropertyOptional({
    description: 'When true, the agent can revoke the credentials issued from this definition.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  supportRevocation?: boolean
}

export class DeleteCredentialDefinitionQueryDto {
  @ApiPropertyOptional({
    description:
      'When true, the agent also deletes each revocation registry and status list related to this credential definition.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  deleteAssociatedRevocationRegistries?: boolean
}

export class CredentialDefinitionDto {
  @ApiProperty({ description: 'Identifier of the credential definition' })
  id!: string

  @ApiProperty({ description: 'Name of the underlying AnonCreds schema' })
  name!: string

  @ApiProperty({ description: 'Version of the underlying AnonCreds schema' })
  version!: string

  @ApiProperty({ type: [String], description: 'Attribute names the schema defines' })
  attributes!: string[]

  @ApiProperty({ description: 'Whether the credential definition supports revocation' })
  supportRevocation!: boolean

  @ApiProperty({
    description: 'Verifiable Trust JSON Schema Credential that governs the credential definition',
  })
  relatedJsonSchemaCredentialId!: string
}

export const CredentialDefinitionPageDto = PageDto(CredentialDefinitionDto)

/**
 * The package that [VSA-ADM-AC-CD-EXPORT] sends. It is also the request body of
 * [VSA-ADM-AC-CD-IMPORT]. You can move this package to a different agent.
 *
 * The specification defines only the `id` field and the `data` field. The fields in `data` are
 * the fields that an import operation needs. An import operation does not connect to the agent
 * that sent the package.
 */
export class CredentialDefinitionPackageDto {
  @ApiProperty({ description: 'Identifier of the exported credential definition' })
  @IsString()
  @IsNotEmpty()
  id!: string

  @ApiProperty({
    description: 'Opaque payload that carries the credential definition and its cryptographic data',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  data!: CredentialDefinitionPackageData
}

export interface CredentialDefinitionPackageData {
  name?: string
  version?: string
  relatedJsonSchemaCredentialId?: string
  credentialDefinition?: unknown
  credentialDefinitionPrivate?: Record<string, unknown>
  keyCorrectnessProof?: Record<string, unknown>
  schema?: unknown
}
