import { ApiProperty } from '@nestjs/swagger'

export class ProtocolModuleDto {
  @ApiProperty({ description: 'Path segment of the module under /v2/didcomm', example: 'basic-messages' })
  module!: string

  @ApiProperty({
    type: [String],
    description: 'Protocol URIs the module implements',
    example: ['https://didcomm.org/basicmessage/1.0', 'https://didcomm.org/basicmessage/2.0'],
  })
  protocols!: string[]
}
