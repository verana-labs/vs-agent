import { ApiProperty } from '@nestjs/swagger'

export class AgentInfoDto {
  @ApiProperty({
    type: String,
    description: 'DID of the agent, created on its first startup',
    example: 'did:webvh:QmScid:agent.example.com',
    required: false,
  })
  did?: string

  @ApiProperty({
    type: String,
    description: 'Running application version',
    example: '1.8.1',
  })
  version!: string
}
