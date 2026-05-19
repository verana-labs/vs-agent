import { DidCommDidExchangeRole, DidCommDidExchangeState, DidCommVersion } from '@credo-ts/didcomm'
import { ApiProperty } from '@nestjs/swagger'

/**
 * Data Transfer Object for a Connection record.
 */
export class ConnectionDto {
  @ApiProperty({
    description: 'Unique connection identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id!: string

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the connection was created',
    example: '2025-07-10T15:30:00Z',
  })
  createdAt!: string

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the connection was last updated',
    example: '2025-07-12T11:20:00Z',
  })
  updatedAt!: string

  @ApiProperty({ description: 'My DID for this connection', example: 'did:web:example.com' })
  did!: string

  @ApiProperty({ description: 'Their DID for this connection', example: 'did:web:other.com' })
  theirDid!: string

  @ApiProperty({ description: 'Their human-readable label', example: 'Alice' })
  theirLabel!: string

  @ApiProperty({
    enum: DidCommDidExchangeState,
    description: 'Current state of the DID exchange',
    example: DidCommDidExchangeState.Completed,
  })
  state!: DidCommDidExchangeState

  @ApiProperty({
    enum: DidCommDidExchangeRole,
    description: 'Role in the DID exchange',
    example: DidCommDidExchangeRole.Responder,
  })
  role!: DidCommDidExchangeRole

  @ApiProperty({ description: 'Optional alias for this connection', example: 'Work Chat' })
  alias?: string

  @ApiProperty({ description: 'Thread identifier for this connection', example: 'thread-abc-123' })
  threadId?: string

  @ApiProperty({
    description: 'Optional URL to display an avatar for this connection',
    example: 'https://example.com/avatar.png',
  })
  imageUrl?: string

  @ApiProperty({ description: 'Out-of-band identifier if invitation was OOB', example: 'oob-xyz-789' })
  outOfBandId?: string

  @ApiProperty({
    description: 'DID of the invitation if forwarded',
    example: 'did:web:forwarded.example.com',
  })
  invitationDid?: string

  @ApiProperty({
    enum: ['v1', 'v2'],
    description: 'DIDComm version negotiated for this connection',
    required: false,
  })
  didcommVersion?: DidCommVersion

  @ApiProperty({
    type: [String],
    description: "Prior values of our DID (this connection's `did`) after rotations",
    required: false,
  })
  previousDids?: string[]

  @ApiProperty({
    type: [String],
    description: "Prior values of the peer's DID (`theirDid`) after rotations they announced",
    required: false,
  })
  previousTheirDids?: string[]
}
