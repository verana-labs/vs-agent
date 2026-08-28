import { DidCommDidExchangeRole, DidCommDidExchangeState, DidCommVersion } from '@credo-ts/didcomm'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator'

import { PageDto, PaginationQueryDto } from '../../../../../common'

/**
 * Query filters of [VSA-ADM-DC-CN-LIST] listConnections
 */
export class ListConnectionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by Out-of-Band identifier' })
  @IsOptional()
  @IsString()
  outOfBandId?: string

  @ApiPropertyOptional({ description: 'Filter by connection state', enum: DidCommDidExchangeState })
  @IsOptional()
  @IsEnum(DidCommDidExchangeState)
  state?: DidCommDidExchangeState

  @ApiPropertyOptional({ description: 'Filter by DID exchange role', enum: DidCommDidExchangeRole })
  @IsOptional()
  @IsEnum(DidCommDidExchangeRole)
  role?: DidCommDidExchangeRole

  @ApiPropertyOptional({ description: 'Filter by my DID for this connection' })
  @IsOptional()
  @IsString()
  did?: string

  @ApiPropertyOptional({ description: 'Filter by the DID of the peer' })
  @IsOptional()
  @IsString()
  theirDid?: string

  @ApiPropertyOptional({ description: 'Filter by DIDComm thread identifier' })
  @IsOptional()
  @IsString()
  threadId?: string

  @ApiPropertyOptional({ description: 'Filter by the invitation DID' })
  @IsOptional()
  @IsString()
  invitationDid?: string

  @ApiPropertyOptional({
    description:
      'Filter by negotiated DIDComm version. `v1` selects the connections established through a ' +
      'handshake protocol, which the store leaves without an explicit version.',
    enum: ['v1', 'v2'],
  })
  @IsOptional()
  @IsIn(['v1', 'v2'])
  didcommVersion?: DidCommVersion

  @ApiPropertyOptional({ description: 'Filter by mediator identifier' })
  @IsOptional()
  @IsString()
  mediatorId?: string
}

/**
 * A DIDComm connection record, as returned by listConnections and getConnection.
 */
export class ConnectionRecordDto {
  @ApiProperty({
    description: 'Unique connection identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id!: string

  @ApiProperty({ enum: DidCommDidExchangeState, description: 'Current state of the DID exchange' })
  state!: DidCommDidExchangeState

  @ApiProperty({ enum: DidCommDidExchangeRole, description: 'Role in the DID exchange' })
  role!: DidCommDidExchangeRole

  @ApiPropertyOptional({ description: 'My DID for this connection', example: 'did:web:example.com' })
  did?: string

  @ApiPropertyOptional({ description: 'DID of the peer', example: 'did:web:other.com' })
  theirDid?: string

  @ApiPropertyOptional({ description: 'Human-readable label of the peer', example: 'Alice' })
  theirLabel?: string

  @ApiPropertyOptional({ description: 'Local alias for this connection', example: 'Work Chat' })
  alias?: string

  @ApiPropertyOptional({ description: 'DIDComm thread identifier', example: 'thread-abc-123' })
  threadId?: string

  @ApiPropertyOptional({ description: 'Avatar URL advertised by the peer' })
  imageUrl?: string

  @ApiPropertyOptional({ description: 'Out-of-Band identifier this connection started from' })
  outOfBandId?: string

  @ApiPropertyOptional({ description: 'DID of the invitation this connection started from' })
  invitationDid?: string

  @ApiPropertyOptional({
    enum: ['v1', 'v2'],
    description:
      'DIDComm version negotiated for this connection. Set only for connections established ' +
      'through the v2 out-of-band flow; absent otherwise.',
  })
  didcommVersion?: DidCommVersion

  @ApiPropertyOptional({ description: 'Mediator that routes messages for this connection' })
  mediatorId?: string

  @ApiPropertyOptional({ type: [String], description: 'Prior values of `did` after rotations' })
  previousDids?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Prior values of `theirDid` after rotations' })
  previousTheirDids?: string[]

  @ApiProperty({ type: String, format: 'date-time', description: 'When the connection was created' })
  createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time', description: 'When the connection was last updated' })
  updatedAt!: Date
}

export const ConnectionRecordPageDto = PageDto(ConnectionRecordDto)
