import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { OpenId4VcIssuanceSessionState } from '@verana-labs/vs-agent-plugin-openid4vc'
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

import { PageDto, PaginationQueryDto } from '../../../../../common'

export class Openid4vcCredentialOfferBodyDto {
  @ApiProperty({
    description: 'Identifier of a credential configuration of the OpenID4VC configuration file',
    example: 'employee',
  })
  @IsString()
  @IsNotEmpty()
  credentialConfigurationId!: string

  @ApiProperty({
    type: Object,
    description:
      'Claim values of the offered credential. Any subset of the configured claims, at least one, each non-empty; an omitted claim is left out of the credential.',
    example: { name: 'Ada Lovelace', role: 'engineer' },
  })
  @IsObject()
  claims!: Record<string, unknown>
}

export class Openid4vcCredentialOfferResponseDto {
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

export class Openid4vcListCredentialExchangesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by credential configuration', example: 'employee' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  credentialConfigurationId?: string

  @ApiPropertyOptional({
    enum: OpenId4VcIssuanceSessionState,
    description: 'Filter by issuance session state',
  })
  @IsOptional()
  @IsEnum(OpenId4VcIssuanceSessionState)
  state?: OpenId4VcIssuanceSessionState
}

export class Openid4vcCredentialExchangeRecordDto {
  @ApiProperty({
    description: 'Identifier of the issuance session',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  credentialExchangeId!: string

  @ApiProperty({ description: 'Credential configuration of the offer', example: 'employee' })
  credentialConfigurationId!: string

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

export const Openid4vcCredentialExchangeRecordPageDto = PageDto(Openid4vcCredentialExchangeRecordDto)
