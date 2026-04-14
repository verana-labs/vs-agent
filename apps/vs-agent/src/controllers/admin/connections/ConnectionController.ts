import { RecordNotFoundError } from '@credo-ts/core'
import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common'
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger'
import { Response } from 'express'

import { VsAgentService } from '../../../services/VsAgentService'

import { ConnectionDto } from './dto/connection.dto'

@ApiTags('connections')
@ApiExtraModels(ConnectionDto)
@Controller({
  path: 'connections',
  version: '1',
})
export class ConnectionController {
  constructor(private readonly agentService: VsAgentService) {}

  /**
   * Retrieve all connections records
   * @param alias Alias
   * @param state Connection state
   * @param myDid My DID
   * @param theirDid Their DID
   * @param theirLabel Their label
   * @returns ConnectionRecord[]
   */
  @Get('/')
  @ApiOperation({
    summary: 'List all connections',
    description: 'Retrieve all connection records, optionally filtered by query parameters.',
  })
  @ApiQuery({ name: 'outOfBandId', required: false, type: String, description: 'Filter by Out-of-band ID' })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Filter by connection state',
    enum: Object.values(DidCommDidExchangeState),
  })
  @ApiQuery({ name: 'did', required: false, type: String, description: 'Filter by my DID' })
  @ApiQuery({ name: 'theirDid', required: false, type: String, description: 'Filter by their DID' })
  @ApiQuery({ name: 'threadId', required: false, type: String, description: 'Filter by thread ID' })
  @ApiOkResponse({
    description: 'Array of connection records',
    schema: { type: 'array', items: { $ref: getSchemaPath(ConnectionDto) } },
  })
  public async getAllConnections(
    @Query('outOfBandId') outOfBandId?: string,
    @Query('state') state?: DidCommDidExchangeState,
    @Query('did') did?: string,
    @Query('theirDid') theirDid?: string,
    @Query('threadId') threadId?: string,
  ) {
    const agent = await this.agentService.getAgent()

    const connections = await agent.didcomm.connections.findAllByQuery({
      did,
      theirDid,
      threadId,
      state,
      outOfBandId,
    })

    return connections.map(record => ({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      did: record.did,
      theirDid: record.theirDid,
      theirLabel: record.theirLabel,
      state: record.state,
      role: record.role,
      alias: record.alias,
      threadId: record.threadId,
      imageUrl: record.imageUrl,
      outOfBandId: record.outOfBandId,
      invitationDid: record.invitationDid,
    }))
  }

  /**
   * Retrieve connection record by connection id
   * @param connectionId Connection identifier
   * @returns ConnectionDto
   */
  @Get(':connectionId')
  @ApiOperation({
    summary: 'Get a connection by ID',
    description: 'Retrieve a single connection record by its unique identifier.',
  })
  @ApiParam({
    name: 'connectionId',
    type: String,
    description: 'UUID of the connection',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'Connection record',
    schema: { $ref: getSchemaPath(ConnectionDto) },
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async getConnectionById(@Param('connectionId') connectionId: string) {
    const agent = await this.agentService.getAgent()

    const connection = await agent.didcomm.connections.findById(connectionId)

    if (!connection)
      throw new NotFoundException({
        reason: `connection with connection id "${connectionId}" not found.`,
      })

    return connection.toJSON()
  }

  /**
   * Deletes a connection record from the connection repository.
   *
   * @param connectionId Connection identifier
   */
  @Delete(':connectionId')
  @ApiOperation({
    summary: 'Delete a connection',
    description: 'Deletes a connection record by its unique identifier.',
  })
  @ApiParam({
    name: 'connectionId',
    type: String,
    description: 'UUID of the connection to delete',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'Connection deleted successfully' })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  public async deleteConnection(
    @Param('connectionId') connectionId: string,
    @Res() response: Response,
  ): Promise<void> {
    const agent = await this.agentService.getAgent()

    try {
      await agent.didcomm.connections.deleteById(connectionId)
      response.status(204)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw new NotFoundException({
          reason: `connection with connection id "${connectionId}" not found.`,
        })
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: `something went wrong: ${error}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      )
    }
  }
}
