import { ApiProperty } from '@nestjs/swagger'

/**
 * Data Transfer Object for VS Agent basic information.
 */
export class VsAgentInfoDto {
  @ApiProperty({
    description: 'Human-readable name of the agent',
    example: 'My Agent',
  })
  label!: string

  @ApiProperty({
    type: [String],
    description: 'List of service endpoints for this agent',
    example: ['https://agent.example.com/comm'],
  })
  endpoints!: string[]

  @ApiProperty({
    description: 'Indicates whether the agent has completed its setup',
    example: true,
  })
  isInitialized!: boolean

  @ApiProperty({
    description: 'Public DID if one is assigned',
    example: 'did:web:agent.example.com',
    required: false,
    nullable: true,
  })
  publicDid?: string

  @ApiProperty({
    description: 'Application version',
    example: '1.8.1',
  })
  version!: string
}
