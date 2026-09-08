import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

export const CALL_TYPES = ['audio', 'video', 'service'] as const

export type CallType = (typeof CALL_TYPES)[number]

export class OfferCallBodyDto {
  @ApiProperty({ description: 'Connection to offer the call on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ enum: CALL_TYPES, description: 'Kind of call' })
  @IsIn(CALL_TYPES)
  callType!: CallType

  @ApiProperty({ description: 'Transport parameters of the call', type: Object })
  @IsObject()
  parameters!: Record<string, unknown>

  @ApiPropertyOptional({ description: 'Text that describes the call' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: 'When the call starts', example: '2026-09-07T12:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  offerStartTime?: string

  @ApiPropertyOptional({ description: 'When the offer expires', example: '2026-09-07T12:05:00.000Z' })
  @IsOptional()
  @IsISO8601()
  offerExpirationTime?: string
}

export class CallThreadBodyDto {
  @ApiProperty({ description: 'Connection of the call', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ description: 'Thread of the call offer' })
  @IsString()
  @IsNotEmpty()
  threadId!: string
}

export class AcceptCallBodyDto extends CallThreadBodyDto {
  @ApiProperty({ description: 'Transport parameters of the accepting side', type: Object })
  @IsObject()
  parameters!: Record<string, unknown>
}
