import { Body, Controller, HttpStatus, Inject, Logger, Post } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { HttpUtils } from '@verana-labs/vs-agent-client'
import { ConnectionStateUpdated, EventType } from '@verana-labs/vs-agent-model'

import { ConnectionsEventService } from './connection.service'

@ApiTags('Connections Event')
@Controller()
export class ConnectionsEventController {
  private readonly logger = new Logger(ConnectionsEventController.name)

  constructor(@Inject(ConnectionsEventService) private readonly service: ConnectionsEventService) {}

  @Post(`/${EventType.ConnectionStateUpdated}`)
  @ApiOperation({
    summary: 'Handle the ConnectionState event',
    description: 'Processes the ConnectionState event and updates the connection state.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Connection state updated successfully.',
    schema: {
      example: { message: 'Connection state updated successfully' },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async update(@Body() body: ConnectionStateUpdated): Promise<{ message: string }> {
    try {
      this.logger.log(`connectionStateUpdated event: ${JSON.stringify(body)}`)

      await this.service.update(body)

      return { message: 'Connection state updated successfully' }
    } catch (error) {
      HttpUtils.handleException(this.logger, error, 'Failed to update connection state')
    }
  }
}
