import { ApiProperty } from '@nestjs/swagger'

export class SentMessageDto {
  @ApiProperty({
    description: 'Identifier of the sent message',
    example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
  })
  id!: string
}
