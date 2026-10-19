import type { DidCommVersion } from '@credo-ts/didcomm'
import type { InvitationState } from '@verana-labs/vs-agent-sdk'

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, Matches } from 'class-validator'

import { PageDto, PaginationQueryDto } from '../../../../../common'

export class CreateInvitationBodyDto {
  @ApiPropertyOptional({
    description:
      'Connection to send the invitation on. When absent, the agent creates a standalone invitation ' +
      'and returns it.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  connectionId?: string

  @ApiPropertyOptional({
    description:
      'DID of the service the peer is invited to connect to (referral). Requires `connectionId`. ' +
      'When absent, the invitation is for a connection to this agent.',
    example: 'did:webvh:QmbfsYcjFS2bnouwXBSoZZ65jREEgZGSPdcatcwY7i1Gq2:verifier.example.com',
  })
  @IsOptional()
  @Matches(/^did:[a-z0-9]+:.+$/, { message: 'did must be a DID' })
  did?: string

  @ApiPropertyOptional({
    description:
      'Accept the standalone invitation any number of times, until the record is deleted. Requires ' +
      'that `connectionId` is absent.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  reusable?: boolean

  @ApiPropertyOptional({
    description:
      'Text the peer shows for a sub-connection invitation or a referral. On a v2 connection it ' +
      'travels as the `description` of the share-media message and as the `metadata.title` of its ' +
      'item. Sub-connection default: the `name` of the ECS-Service credential of the agent, omitted ' +
      'when it holds none. Ignored for a standalone invitation.',
    example: 'My Service',
  })
  @IsOptional()
  @IsString()
  label?: string

  @ApiPropertyOptional({
    description:
      'URL of an image the peer shows for a sub-connection invitation or a referral. On a v2 ' +
      'connection it travels as the `metadata.icon` of the item of the share-media message. Ignored ' +
      'for a standalone invitation.',
    example: 'https://example.com/logo.png',
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string

  @ApiPropertyOptional({ description: 'The `goal` of the invitation', example: 'Open a support chat' })
  @IsOptional()
  @IsString()
  goal?: string

  @ApiPropertyOptional({ description: 'The `goal_code` of the invitation', example: 'support-chat' })
  @IsOptional()
  @IsString()
  goalCode?: string

  @ApiPropertyOptional({
    description:
      'Advertise the legacy did:web form when the DID of the agent is did:webvh. Ignored when ' +
      '`connectionId` is present.',
  })
  @IsOptional()
  @IsBoolean()
  useLegacyDid?: boolean

  @ApiPropertyOptional({
    enum: ['v1', 'v2'],
    description:
      "DIDComm envelope version of a standalone invitation. Defaults to 'v2'. Ignored when " +
      '`connectionId` is present.',
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didcommVersion?: 'v1' | 'v2'
}

export class CreateInvitationResponseDto {
  @ApiPropertyOptional({
    description:
      'Identifier of the invitation record. Absent for a referral. The connection the invitation ' +
      'produces carries this value as `invitationId`.',
    example: '8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  })
  id?: string

  @ApiPropertyOptional({
    description:
      'The Out-of-Band invitation, in the envelope that `didcommVersion` selects. Present for a ' +
      'standalone invitation only.',
    type: 'object',
    additionalProperties: true,
  })
  invitation?: Record<string, unknown>

  @ApiPropertyOptional({
    description:
      'A URL under PUBLIC_API_BASE_URL that resolves to the same invitation, for a QR code. Present ' +
      'for a standalone invitation only.',
    example: 'https://mydomain.com/s?id=abcd',
  })
  shortUrl?: string

  @ApiPropertyOptional({
    description:
      'Identifier of the sent message: the Out-of-Band 1.1 invitation on a v1 connection, the ' +
      'share-media message that carries the Out-of-Band 2.0 invitation on a v2 connection. Present ' +
      'when `connectionId` is present.',
    example: 'b6a2f0d4-7c1e-4f6a-9d2b-0f3c5e8a1b7d',
  })
  messageId?: string
}

/**
 * Query filters of [VSA-ADM-DC-INV-LIST] listInvitations
 */
export class ListInvitationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['created', 'accepted'], description: 'Filter by state' })
  @IsOptional()
  @IsIn(['created', 'accepted'])
  state?: InvitationState

  @ApiPropertyOptional({ description: 'Filter by the connection that carried a sub-connection invitation' })
  @IsOptional()
  @IsString()
  parentConnectionId?: string

  @ApiPropertyOptional({ description: 'Filter by a connection that appears in `acceptances`' })
  @IsOptional()
  @IsString()
  connectionId?: string

  @ApiPropertyOptional({ type: Boolean, description: 'Filter by `reusable`' })
  @IsOptional()
  @IsIn(['true', 'false'])
  reusable?: 'true' | 'false'

  @ApiPropertyOptional({ enum: ['v1', 'v2'], description: 'Filter by the envelope of the invitation' })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didcommVersion?: DidCommVersion
}

export class InvitationAcceptanceDto {
  @ApiProperty({ description: 'The connection that the acceptance produced, or that the peer reused' })
  connectionId!: string

  @ApiProperty({
    description:
      'True when the peer accepted the invitation on a connection that it already held, false when ' +
      'the acceptance produced a new connection',
  })
  reused!: boolean

  @ApiProperty({ type: String, format: 'date-time', description: 'When the peer accepted the invitation' })
  acceptedAt!: string
}

/**
 * An invitation record, as returned by listInvitations and getInvitation.
 */
export class InvitationRecordDto {
  @ApiProperty({ description: 'Identifier of the record', example: '8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f' })
  id!: string

  @ApiProperty({ enum: ['created', 'accepted'], description: 'State of the invitation' })
  state!: InvitationState

  @ApiProperty({ enum: ['v1', 'v2'], description: 'The envelope of the invitation' })
  didcommVersion!: DidCommVersion

  @ApiProperty({ description: 'True when the agent accepts the invitation any number of times' })
  reusable!: boolean

  @ApiProperty({
    description: 'The Out-of-Band invitation',
    type: 'object',
    additionalProperties: true,
  })
  invitation!: Record<string, unknown>

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The short URL of a standalone invitation, or null',
    example: 'https://mydomain.com/s?id=abcd',
  })
  shortUrl!: string | null

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The connection that carried a sub-connection invitation, or null for a standalone invitation',
  })
  parentConnectionId!: string | null

  @ApiProperty({
    type: [InvitationAcceptanceDto],
    description: 'The acceptances of the invitation, empty while the state is `created`',
  })
  acceptances!: InvitationAcceptanceDto[]

  @ApiProperty({ type: String, format: 'date-time', description: 'When the record was created' })
  createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time', description: 'When the record was last updated' })
  updatedAt!: Date
}

export const InvitationRecordPageDto = PageDto(InvitationRecordDto)
