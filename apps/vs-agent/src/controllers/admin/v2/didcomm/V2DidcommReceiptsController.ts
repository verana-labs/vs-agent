import { DidCommMessageReceipt, DidCommReceiptsService } from '@2060.io/credo-ts-didcomm-receipts'
import { Body, Controller, HttpStatus, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'
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

    if (!agent.context.dependencyManager.isRegistered(DidCommReceiptsService)) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        'this deployment does not serve the receipts module',
      )
    }
    const receiptsService = agent.context.dependencyManager.resolve(DidCommReceiptsService)

    const connection = await agent.didcomm.connections.findById(body.connectionId)
    if (!connection) throw unknownConnection(body.connectionId)
    const message = await receiptsService.createReceiptsMessage({
      receipts: body.receipts.map(
        receipt =>
          new DidCommMessageReceipt({
            messageId: receipt.messageId,
            state: receipt.state,
            timestamp: receipt.timestamp ? new Date(receipt.timestamp) : undefined,
          }),
      ),
    })

    await agent.context.dependencyManager
      .resolve(DidCommMessageSender)
      .sendMessage(new DidCommOutboundMessageContext(message, { agentContext: agent.context, connection }))

    return { id: message.id }
  }
}
