import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'

import { PaginationQueryDto } from '../../../../../common'
import { REVOCATION_REGISTRY_DEFAULT_CAPACITY } from '../../../../../config/constants'

/**
 * Query filter of [VSA-ADM-AC-RR-LIST] listRevocationRegistries
 */
export class ListRevocationRegistriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Return only the registries bound to this credential definition',
    example:
      'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  credentialDefinitionId?: string
}

/**
 * Request body of [VSA-ADM-AC-RR-CREATE] createRevocationRegistry
 */
export class CreateRevocationRegistryBodyDto {
  @ApiProperty({
    description: 'Credential definition the registry is bound to',
    example:
      'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
  })
  @IsString()
  @IsNotEmpty()
  credentialDefinitionId!: string

  @ApiPropertyOptional({
    description: 'Capacity of the registry',
    default: REVOCATION_REGISTRY_DEFAULT_CAPACITY,
    example: REVOCATION_REGISTRY_DEFAULT_CAPACITY,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maximumCredentialNumber?: number
}

/**
 * `PageDto` builds a page model off a record class, and the records here are plain identifiers,
 * so this envelope is written out. It must stay identical to the generated one.
 */
export class RevocationRegistryDefinitionIdPageDto {
  @ApiProperty({
    type: [String],
    description: 'The records of this page.',
    example: [
      'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/revRegDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
    ],
  })
  items!: string[]

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor of the next page. The agent sets it to null on the last page.',
  })
  nextCursor!: string | null
}

export class CreateRevocationRegistryResponseDto {
  @ApiProperty({
    description: 'Identifier of the created revocation registry definition',
    example:
      'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/revRegDef/8TsGLaSPVKPVMXK8APzBRcXZryxutvQuZnnTcDmbqd9p',
  })
  revocationRegistryDefinitionId!: string
}
