import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { RecordNotFoundError } from '@credo-ts/core'
import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Query } from '@nestjs/common'
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode, Page, paginate } from '../../../../common'
import { AccessMode } from '../../../../security'
import { VsAgentService } from '../../../../services/VsAgentService'

import { ConnectionRecordDto, ConnectionRecordPageDto, ListConnectionsQueryDto } from './dto'

/**
 * DIDComm connection records held by this agent.
 *
 * The agent has no method that creates a bare connection invitation: a connection starts either
 * from an invitation minted by `createPresentationRequest` / `createCredentialOffer`, or from a
 * peer that connects to the agent.
 */
@ApiTags('v2/didcomm')
@AccessMode('INTERNAL')
@Controller({ path: 'didcomm/connections', version: '2' })
export class V2DidcommConnectionsController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Get()
  @ApiOperation({
    summary: 'List connections',
    description: 'Returns the connection records, filtered when the caller supplies a filter.',
  })
  @ApiOkResponse({ description: 'A page of connection records', type: ConnectionRecordPageDto })
  public async listConnections(@Query() query: ListConnectionsQueryDto): Promise<Page<ConnectionRecordDto>> {
    const agent = await this.vsAgentService.getAgent()

    const filters = {
      outOfBandId: query.outOfBandId,
      state: query.state,
      role: query.role,
      did: query.did,
      theirDid: query.theirDid,
      threadId: query.threadId,
      invitationDid: query.invitationDid,
      didcommVersion: query.didcommVersion,
      mediatorId: query.mediatorId,
    }

    const records = await agent.didcomm.connections.findAllByQuery(filters)

    return paginate(
      records.map(toConnectionDto),
      query,
      { method: 'listConnections', filters },
      connection => `${connection.createdAt.toISOString()}|${connection.id}`,
    )
  }

  @Get(':connectionId')
  @ApiOperation({
    summary: 'Get a connection',
    description: 'Retrieves one connection record by identifier.',
  })
  @ApiParam({
    name: 'connectionId',
    type: String,
    description: 'UUID of the connection',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The connection record', type: ConnectionRecordDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async getConnection(@Param('connectionId') connectionId: string): Promise<ConnectionRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.connections.findById(connectionId)
    if (!record) throw unknownConnection(connectionId)

    return toConnectionDto(record)
  }

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a connection',
    description:
      'Deletes a connection record, and drops the routing it held on its mediator when it had one.',
  })
  @ApiParam({
    name: 'connectionId',
    type: String,
    description: 'UUID of the connection to delete',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'The connection record is deleted' })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async deleteConnection(@Param('connectionId') connectionId: string): Promise<void> {
    const agent = await this.vsAgentService.getAgent()

    try {
      await agent.didcomm.connections.deleteById(connectionId)
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw unknownConnection(connectionId)
      throw error
    }
  }
}

function toConnectionDto(record: DidCommConnectionRecord): ConnectionRecordDto {
  return {
    id: record.id,
    state: record.state,
    role: record.role,
    did: record.did,
    theirDid: record.theirDid,
    theirLabel: record.theirLabel,
    alias: record.alias,
    threadId: record.threadId,
    imageUrl: record.imageUrl,
    outOfBandId: record.outOfBandId,
    invitationDid: record.invitationDid,
    didcommVersion: record.didcommVersion,
    mediatorId: record.mediatorId,
    previousDids: record.previousDids,
    previousTheirDids: record.previousTheirDids,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  }
}

function unknownConnection(connectionId: string): AdminApiError {
  return new AdminApiError(
    AdminApiErrorCode.UnknownId,
    HttpStatus.NOT_FOUND,
    `no connection with id "${connectionId}"`,
  )
}
