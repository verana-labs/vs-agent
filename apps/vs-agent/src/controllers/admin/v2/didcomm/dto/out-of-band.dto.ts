import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional, IsString, IsUrl } from 'class-validator'

/**
 * Body of [VSA-ADM-DC-OOB-CREATE] createOutOfBandInvitation: a connection invitation that a peer
 * accepts out of band (QR code, link), without an existing connection to send it on.
 */
export class CreateOutOfBandInvitationBodyDto {
  @ApiPropertyOptional({
    description: 'Text the peer shows for the invitation. Default: the ECS-Service credential name.',
    example: 'Acme Support',
  })
  @IsOptional()
  @IsString()
  label?: string

  @ApiPropertyOptional({ description: 'URL of an image the peer shows for the invitation.' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string

  @ApiPropertyOptional({ description: 'The `goal` of the invitation', example: 'Link a web session' })
  @IsOptional()
  @IsString()
  goal?: string

  @ApiPropertyOptional({ description: 'The `goal_code` of the invitation', example: 'hologram.bind-session' })
  @IsOptional()
  @IsString()
  goalCode?: string

  @ApiPropertyOptional({
    enum: ['v1', 'v2'],
    description: 'DIDComm version of the invitation envelope. Default: v1 (Out-of-Band 1.1).',
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didcommVersion?: 'v1' | 'v2'

  @ApiPropertyOptional({
    description: 'Whether several peers may accept the invitation. Default: false (single use).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  multiUse?: boolean

  @ApiPropertyOptional({
    description: 'Also mint a short URL (`/s?id=`) resolving to the invitation. Default: false.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  shortUrl?: boolean
}

export class CreateOutOfBandInvitationResponseDto {
  @ApiProperty({
    description:
      'Identifier of the Out-of-Band record. Connections created from it carry it as `outOfBandId`.',
  })
  outOfBandId!: string

  @ApiProperty({
    description:
      'Identifier of the invitation message (`@id` / `id`). A peer that already holds a connection ' +
      'to this agent reuses it with a handshake-reuse message whose parent thread is this value ' +
      '(see the `didcomm.out-of-band.handshake-reused` event).',
  })
  invitationId!: string

  @ApiProperty({ description: 'The invitation as a plaintext JSON object' })
  invitation!: Record<string, unknown>

  @ApiProperty({ description: 'The invitation URL (`?oob=` for v1, `?_oob=` for v2) on the public base URL' })
  url!: string

  @ApiPropertyOptional({ description: 'Short URL resolving to the invitation, when requested' })
  shortUrl?: string
}
