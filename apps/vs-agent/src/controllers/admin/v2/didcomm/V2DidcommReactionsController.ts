import {
  DidCommMessageReaction,
  DidCommMessageReactionAction,
  DidCommReactionsService,
} from '@2060.io/credo-ts-didcomm-reactions'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'

import { SendReactionsBodyDto, SentMessageDto } from './dto'
import { connectionOf, moduleService, sendMessage } from './moduleEndpoint'

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
    const service = moduleService(agent, DidCommReactionsService, 'reactions')
    const connection = await connectionOf(agent, body.connectionId)

    const message = await service.createReactionsMessage({
      reactions: body.reactions.map(
        reaction =>
          new DidCommMessageReaction({
            messageId: reaction.messageId,
            emoji: reaction.emoji,
            action: reaction.action as DidCommMessageReactionAction,
            timestamp: reaction.timestamp ? new Date(reaction.timestamp) : undefined,
          }),
      ),
    })

    return { id: await sendMessage(agent, connection, message) }
  }
}
