import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'

import { SendReactionsBodyDto, SentMessageDto } from './dto'
import { chatModuleApi, connectionOf } from './moduleEndpoint'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/reactions', version: '2' })
export class V2DidcommReactionsController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send message reactions',
    description: 'Sends emoji reactions to messages on an established connection.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendReactions(@Body() body: SendReactionsBodyDto): Promise<SentMessageDto> {
    const agent = await this.vsAgentService.getAgent()
    const api = chatModuleApi(agent, 'reactions', 'reactions')
    await connectionOf(agent, body.connectionId)

    const { messageId } = await api.send({
      connectionId: body.connectionId,
      reactions: body.reactions.map(reaction => ({
        messageId: reaction.messageId,
        emoji: reaction.emoji,
        action: reaction.action,
        timestamp: reaction.timestamp ? new Date(reaction.timestamp) : undefined,
      })),
    })

    return { id: messageId }
  }
}
