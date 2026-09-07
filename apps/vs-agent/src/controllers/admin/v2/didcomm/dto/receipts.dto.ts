import { MessageState } from '@2060.io/credo-ts-didcomm-receipts'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

/**
 * One entry of [VSA-ADM-DC-RC-SEND] sendReceipts.
 */
export class MessageReceiptDto {
  @ApiProperty({ description: 'Identifier of the message the receipt refers to', example: 'msg-1234' })
  @IsString()
  @IsNotEmpty()
  messageId!: string

  @ApiProperty({ enum: MessageState, description: 'State reported for the message' })
  @IsEnum(MessageState)
  state!: MessageState

  @ApiPropertyOptional({ description: 'When the state was reached', example: '2026-09-07T12:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  timestamp?: string
}

/**
 * Body of [VSA-ADM-DC-RC-SEND] sendReceipts.
 */
export class SendReceiptsBodyDto {
  @ApiProperty({ description: 'Connection to send the receipts on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ type: [MessageReceiptDto], description: 'The receipts to send' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MessageReceiptDto)
  receipts!: MessageReceiptDto[]
}

/**
 * Response of [VSA-ADM-DC-RC-SEND] sendReceipts.
 */
export class SendReceiptsResponseDto {
  @ApiProperty({
    description: 'Identifier of the sent message',
    example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
  })
  id!: string
}
