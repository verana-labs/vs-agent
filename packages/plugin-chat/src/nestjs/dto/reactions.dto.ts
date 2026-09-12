import { DidCommMessageReactionAction } from '@2060.io/credo-ts-didcomm-reactions'
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

export class MessageReactionDto {
  @ApiProperty({ description: 'Identifier of the message the reaction refers to', example: 'msg-1234' })
  @IsString()
  @IsNotEmpty()
  messageId!: string

  @ApiProperty({ description: 'The emoji', example: '👍' })
  @IsString()
  @IsNotEmpty()
  emoji!: string

  @ApiProperty({ enum: DidCommMessageReactionAction, description: 'Whether the emoji is set or removed' })
  @IsEnum(DidCommMessageReactionAction)
  action!: DidCommMessageReactionAction

  @ApiPropertyOptional({ description: 'When the reaction was made', example: '2026-09-07T12:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  timestamp?: string
}

export class SendReactionsBodyDto {
  @ApiProperty({ description: 'Connection to send the reactions on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ type: [MessageReactionDto], description: 'The reactions to send' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => MessageReactionDto)
  reactions!: MessageReactionDto[]
}
