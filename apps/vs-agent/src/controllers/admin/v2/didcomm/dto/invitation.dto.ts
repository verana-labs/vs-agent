import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUrl, Matches } from 'class-validator'

export class SendInvitationBodyDto {
  @ApiProperty({
    description: 'Connection to send the invitation on',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  connectionId!: string

  @ApiPropertyOptional({
    description:
      'DID of the service the peer is invited to connect to (referral). When absent, the ' +
      'invitation opens a sub-connection to this agent.',
    example: 'did:webvh:QmbfsYcjFS2bnouwXBSoZZ65jREEgZGSPdcatcwY7i1Gq2:verifier.example.com',
  })
  @IsOptional()
  @Matches(/^did:[a-z0-9]+:.+$/, { message: 'did must be a DID' })
  did?: string

  @ApiPropertyOptional({
    description:
      'Text the peer shows for the invitation. Out-of-Band 1.1 only. Sub-connection default: the ' +
      '`name` of the ECS-Service credential of the agent, omitted when it holds none.',
    example: 'My Service',
  })
  @IsOptional()
  @IsString()
  label?: string

  @ApiPropertyOptional({
    description: 'URL of an image the peer shows for the invitation. Out-of-Band 1.1 only.',
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
}

export class SendInvitationResponseDto {
  @ApiProperty({
    description:
      'Identifier of the sent message: the Out-of-Band 1.1 message on a v1 connection, the basic ' +
      'message record that carries the invitation URL on a v2 connection.',
    example: 'b6a2f0d4-7c1e-4f6a-9d2b-0f3c5e8a1b7d',
  })
  id!: string

  @ApiPropertyOptional({
    description:
      'Identifier of the Out-of-Band record created for a sub-connection invitation. Absent for a ' +
      'referral. The connection the invitation produces carries this value as `outOfBandId`.',
    example: '8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  })
  outOfBandId?: string
}
