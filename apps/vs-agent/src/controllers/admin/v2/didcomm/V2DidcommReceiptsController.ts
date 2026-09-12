import type { ChatAgentModules } from '@verana-labs/vs-agent-plugin-chat'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { Body, Controller, HttpStatus, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode, unknownConnection } from '../../../../common'
import { VsAgentService } from '../../../../services/VsAgentService'

import { SendReceiptsBodyDto, SendReceiptsResponseDto } from './dto'

/**
 * The module stores no record, so there is no list or get method: an inbound `message-receipts`
 * message reaches the caller as an event.
 */
@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/receipts', version: '2' })
export class V2DidcommReceiptsController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send message receipts',
    description: 'Sends message receipts on an established connection.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SendReceiptsResponseDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async sendReceipts(@Body() body: SendReceiptsBodyDto): Promise<SendReceiptsResponseDto> {
    const agent = await this.vsAgentService.getAgent()
    const { modules } = agent as unknown as VsAgent<ChatAgentModules>

    if (!('receipts' in modules)) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        'this deployment does not serve the receipts module',
      )
    }

    const connection = await agent.didcomm.connections.findById(body.connectionId)
    if (!connection) throw unknownConnection(body.connectionId)

    const { messageId } = await modules.receipts.send({
      connectionId: body.connectionId,
      receipts: body.receipts.map(receipt => ({
        messageId: receipt.messageId,
        state: receipt.state,
        timestamp: receipt.timestamp ? new Date(receipt.timestamp) : undefined,
      })),
    })

    return { id: messageId }
  }
}
