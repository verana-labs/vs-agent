import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'
import { PageDto, PaginationQueryDto } from '@verana-labs/vs-agent-sdk'
import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'

import { OFFER_TTL_SECONDS_MAX, OFFER_TTL_SECONDS_MIN } from '../../config'

/** Request body of [VSA-ADM-OID-CE] createCredentialOffer. */
export class OpenId4VcCreateCredentialOfferBodyDto {
  @ApiProperty({
    description:
      'Credential type of the offer. The agent derives no credential type yet, so every identifier answers UNKNOWN_ID.',
    example: 'employee',
  })
  @IsString()
  @IsNotEmpty()
  jsonSchemaCredentialId!: string

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Claim values of the offered credential. Any subset of the configured claims, at least one, each non-empty; an omitted claim is left out of the credential.',
    example: { name: 'Ada Lovelace', role: 'engineer' },
  })
  @IsObject()
  claims!: Record<string, unknown>

  @ApiProperty({
    type: Number,
    minimum: OFFER_TTL_SECONDS_MIN,
    maximum: OFFER_TTL_SECONDS_MAX,
    description:
      'Lifetime of the credential in seconds, from 60 up to 7776000 (90 days). Nothing revokes the credential, so this lifetime is its only bound.',
    example: 3600,
  })
  @IsInt()
  @Min(OFFER_TTL_SECONDS_MIN)
  @Max(OFFER_TTL_SECONDS_MAX)
  ttlSeconds!: number

  @ApiPropertyOptional({
    description:
      'Status list the credential is registered on, with statusListIndex. The agent hosts no status list yet, so every identifier answers UNKNOWN_ID.',
    example: 'list-1',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  statusListId?: string

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Index of the credential on that status list. Required whenever statusListId is present.',
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  statusListIndex?: number
}

/** Response of [VSA-ADM-OID-CE] createCredentialOffer. */
export class OpenId4VcCredentialOfferResponseDto {
  @ApiProperty({
    description: 'Identifier of the issuance session, for later tracking',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  credentialExchangeId!: string

  @ApiProperty({
    description: 'Credential offer URI, ready to render as a QR code or to send as a link',
    example:
      'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fagent.example%2Foid4vci%2Fissuer%2Foffers%2F1',
  })
  url!: string
}

/** Query of [VSA-ADM-OID-CE] listCredentialExchanges. */
export class OpenId4VcListCredentialExchangesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by credential type', example: 'employee' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  jsonSchemaCredentialId?: string

  @ApiPropertyOptional({ description: 'Filter by the status list the offer named', example: 'list-1' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  statusListId?: string

  @ApiPropertyOptional({
    enum: OpenId4VcIssuanceSessionState,
    description: 'Filter by issuance session state',
  })
  @IsOptional()
  @IsEnum(OpenId4VcIssuanceSessionState)
  state?: OpenId4VcIssuanceSessionState
}

/** A credential exchange record, as returned by listCredentialExchanges and getCredentialExchange. */
export class OpenId4VcCredentialExchangeRecordDto {
  @ApiProperty({
    description: 'Identifier of the issuance session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  credentialExchangeId!: string

  @ApiProperty({ description: 'Credential type of the offer', example: 'employee' })
  jsonSchemaCredentialId!: string

  @ApiPropertyOptional({
    description: 'Status list the credential is registered on. Present only when the offer set it.',
    example: 'list-1',
  })
  statusListId?: string

  @ApiPropertyOptional({
    type: Number,
    description: 'Index of the credential on that status list. Present only when the offer set it.',
    example: 42,
  })
  statusListIndex?: number

  @ApiProperty({ enum: OpenId4VcIssuanceSessionState, description: 'State of the issuance session' })
  state!: OpenId4VcIssuanceSessionState

  @ApiProperty({ type: String, format: 'date-time', description: 'When the agent created the offer' })
  createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time', description: 'When the session last changed' })
  updatedAt!: Date

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'When the offer stops being valid' })
  expiresAt?: Date

  @ApiPropertyOptional({ description: 'Error message on the session. The agent sets it if the flow stops.' })
  errorMessage?: string
}

export const OpenId4VcCredentialExchangeRecordPageDto = PageDto(OpenId4VcCredentialExchangeRecordDto)
