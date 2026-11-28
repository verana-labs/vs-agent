import { RecordNotFoundError } from '@credo-ts/core'
import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common'
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { createdAtKey, mapPage, Page, paginate, unknownConnection } from '../../../../common'
import { VsAgentService } from '../../../../services/VsAgentService'

import {
  ConnectionRecordDto,
  ConnectionRecordPageDto,
  DeleteConnectionQueryDto,
  ListConnectionsQueryDto,
} from './dto'
import { toConnectionDto } from './mappers'

/**
 * DIDComm connection records held by this agent.
 *
 * A connection starts from an invitation minted by `createInvitation`, `createPresentationRequest`
 * or `createCredentialOffer`, or from a peer that connects to the DID of the agent.
 */
@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/connections', version: '2' })
export class V2DidcommConnectionsController {
  private readonly logger = new Logger(V2DidcommConnectionsController.name)

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
      invitationId: query.invitationId,
      parentConnectionId: query.parentConnectionId,
      state: query.state,
      role: query.role,
      did: query.did,
      theirDid: query.theirDid,
      threadId: query.threadId,
      invitationDid: query.invitationDid,
      mediatorId: query.mediatorId,
    }

    // Credo tags only v2 out-of-band connections and reads the absent value as v1, so a `v1`
    // filter can never match a tag value and has to be the negation of v2 instead.
    const records = await agent.didcomm.connections.findAllByQuery(
      query.didcommVersion === 'v1'
        ? { $and: [filters, { $not: { didcommVersion: 'v2' } }] }
        : { ...filters, didcommVersion: query.didcommVersion },
    )

    const page = paginate(
      records,
      query,
      // Scoped on what the caller asked for, not on the translated query, so the cursor is stable.
      { method: 'listConnections', filters: { ...filters, didcommVersion: query.didcommVersion } },
      createdAtKey,
    )

    return mapPage(page, toConnectionDto)
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

  @Post(':connectionId/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Terminate a connection',
    description:
      'Ends the DIDComm relationship and keeps the record: tells the peer that the connection ends ' +
      '(a hangup) and marks the record `abandoned`, so that its history stays readable and no ' +
      'further message is sent on it. Delete the connection to drop the record as well.',
  })
  @ApiParam({
    name: 'connectionId',
    type: String,
    description: 'UUID of the connection to terminate',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({ description: 'The terminated connection record', type: ConnectionRecordDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async terminateConnection(
    @Param('connectionId') connectionId: string,
  ): Promise<ConnectionRecordDto> {
    const agent = await this.vsAgentService.getAgent()

    const record = await agent.didcomm.connections.findById(connectionId)
    if (!record) throw unknownConnection(connectionId)

    if (record.state === DidCommDidExchangeState.Abandoned) return toConnectionDto(record)

    // Credo marks the record abandoned when it hangs up, before it sends the message, so the state
    // change is delivered like any other. The record is read back for what Credo stored.
    await this.hangup(agent, connectionId)

    return toConnectionDto(await agent.didcomm.connections.getById(connectionId))
  }

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a connection',
    description:
      'Deletes the connection record. Unless `notify` is false, the agent first tells the peer ' +
      'that the connection ends (a hangup).',
  })
  @ApiParam({
    name: 'connectionId',
    type: String,
    description: 'UUID of the connection to delete',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiNoContentResponse({ description: 'The connection record is deleted' })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async deleteConnection(
    @Param('connectionId') connectionId: string,
    // esbuild drops the design:type metadata that the global pipe infers from, so the type is named
    @Query(new ValidationPipe({ expectedType: DeleteConnectionQueryDto })) query: DeleteConnectionQueryDto,
  ): Promise<void> {
    const agent = await this.vsAgentService.getAgent()

    if (query.notify !== 'false') await this.hangup(agent, connectionId)

    try {
      await agent.didcomm.connections.deleteById(connectionId)
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw unknownConnection(connectionId)
      throw error
    }
  }

  /** Tells the peer that the connection ends. A peer that cannot be reached is logged, not an error. */
  private async hangup(agent: Awaited<ReturnType<VsAgentService['getAgent']>>, connectionId: string) {
    try {
      await agent.didcomm.connections.hangup({ connectionId })
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw unknownConnection(connectionId)
      this.logger.warn(`Cannot tell connection ${connectionId} that it ends: ${error}`)
    }
  }
}
