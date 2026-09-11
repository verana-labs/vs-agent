import { Body, Controller, HttpStatus, Inject, Logger, Post } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { HttpUtils } from '@verana-labs/vs-agent-client'
import { EventType, MessageReceived } from '@verana-labs/vs-agent-model'

import { MessageEventService } from './message.service'

@ApiTags('Message Event')
@Controller()
export class MessageEventController {
  private readonly logger = new Logger(MessageEventController.name)

  constructor(@Inject(MessageEventService) private readonly message: MessageEventService) {}

  @Post(`/${EventType.MessageReceived}`)
  @ApiOperation({
    summary: 'Handle the MessageReceived event',
    description: 'Processes the MessageReceived event and updates the message state.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Message received updated successfully.',
    schema: {
      example: { message: 'Message received updated successfully' },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data.' })
  @ApiResponse({ status: HttpStatus.INTERNAL_SERVER_ERROR, description: 'Internal server error.' })
  async received(@Body() body: MessageReceived): Promise<{ message: string }> {
    try {
      this.logger.log(`messageReceived event: ${JSON.stringify(body)}`)

      await this.message.received(body)
      return { message: 'Message received updated successfully' }
    } catch (error) {
      HttpUtils.handleException(this.logger, error, 'Failed to received message state')
    }
  }
}
