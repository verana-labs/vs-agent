import { ApiProperty } from '@nestjs/swagger'

export class LivenessDto {
  @ApiProperty({
    type: String,
    enum: ['live'],
    description: 'Fixed marker that the agent process accepted the request',
    example: 'live',
  })
  status!: 'live'
}

export class ReadinessDto {
  @ApiProperty({
    type: String,
    enum: ['ready'],
    description: 'Fixed marker that every bootstrap step completed and the agent is up to date',
    example: 'ready',
  })
  status!: 'ready'
}
