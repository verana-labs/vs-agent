import type { ChatAgentModules } from '../types'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { ActionMenu } from '@credo-ts/action-menu'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { SendMenuBodyDto, SentMessageDto } from './dto'
import { connectionOf } from '@verana-labs/vs-agent-sdk'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/action-menu', version: '2' })
export class V2DidcommActionMenuController {
  public constructor(@Inject('VSAGENT') private readonly agent: VsAgent<ChatAgentModules>) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({ summary: 'Send a menu', description: 'Sends a menu on an established connection.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendMenu(@Body() body: SendMenuBodyDto): Promise<SentMessageDto> {
    await connectionOf(this.agent, body.connectionId)

    const { messageId } = await this.agent.modules.actionMenu.sendMenuWithMessageId({
      connectionId: body.connectionId,
      menu: new ActionMenu(body.menu),
    })

    return { id: messageId }
  }
}
