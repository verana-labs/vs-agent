import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { SendReceiptsBodyDto, SentMessageDto } from './dto'
import { connectionOf } from '@verana-labs/vs-agent-sdk'
import { chatModuleApi } from './chatModuleApi'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/receipts', version: '2' })
export class V2DidcommReceiptsController {
  public constructor(@Inject('VSAGENT') private readonly vsAgent: VsAgent<BaseAgentModules>) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send message receipts',
    description: 'Sends message receipts on an established connection.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendReceipts(@Body() body: SendReceiptsBodyDto): Promise<SentMessageDto> {
    const agent = await this.agent()
    const api = chatModuleApi(agent, 'receipts', 'receipts')
    await connectionOf(agent, body.connectionId)

    const { messageId } = await api.send({
      connectionId: body.connectionId,
      receipts: body.receipts.map(receipt => ({
        messageId: receipt.messageId,
        state: receipt.state,
        timestamp: receipt.timestamp ? new Date(receipt.timestamp) : undefined,
      })),
    })

    return { id: messageId }
  }

  private async agent(): Promise<VsAgent<BaseAgentModules>> {
    if (!this.vsAgent.isInitialized) await this.vsAgent.initialize()
    return this.vsAgent
  }
}
