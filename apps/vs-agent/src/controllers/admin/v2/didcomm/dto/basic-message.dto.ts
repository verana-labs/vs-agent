import { DidCommBasicMessageRole } from '@credo-ts/didcomm'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator'

import { PageDto, PaginationQueryDto } from '../../../../../common'

export class SendBasicMessageBodyDto {
  @ApiProperty({
    description: 'Connection to send the message on',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({ description: 'Text of the message', example: 'Hello' })
  @IsString()
  @IsNotEmpty()
  content!: string
}

export class ListBasicMessagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by connection' })
  @IsOptional()
  @IsString()
  connectionId?: string

  @ApiPropertyOptional({
    description: 'Filter by the role of the agent in the message',
    enum: DidCommBasicMessageRole,
  })
  @IsOptional()
  @IsEnum(DidCommBasicMessageRole)
  role?: DidCommBasicMessageRole
}

export class BasicMessageRecordDto {
  @ApiProperty({
    description: 'Identifier of the message record',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id!: string

  @ApiProperty({ description: 'Connection the message travelled on' })
  connectionId!: string

  @ApiProperty({
    enum: DidCommBasicMessageRole,
    description: 'Whether this agent sent or received the message',
  })
  role!: DidCommBasicMessageRole

  @ApiProperty({ description: 'Text of the message' })
  content!: string

  @ApiProperty({
    description: 'When the sender sent the message, ISO 8601',
    example: '2026-09-10T12:00:00.000Z',
  })
  sentTime!: string

  @ApiPropertyOptional({
    description:
      'DIDComm message id of the message. A basic message starts its own thread, so its thread id is ' +
      'its message id: the id that a receipt or a reaction names, and the `id` that ' +
      '`sendBasicMessage` returns for a message this agent sent.',
    example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
  })
  threadId?: string

  @ApiProperty({ type: String, format: 'date-time', description: 'When the agent stored the message' })
  createdAt!: Date
}

export const BasicMessageRecordPageDto = PageDto(BasicMessageRecordDto)
