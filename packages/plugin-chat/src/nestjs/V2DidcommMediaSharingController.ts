import type { ChatAgentModules } from '../types'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { SharedMediaItem } from '@2060.io/credo-ts-didcomm-media-sharing'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { SentMessageDto, ShareMediaBodyDto } from './dto'
import { connectionOf } from '@verana-labs/vs-agent-sdk'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/media-sharing', version: '2' })
export class V2DidcommMediaSharingController {
  public constructor(@Inject('VSAGENT') private readonly agent: VsAgent<ChatAgentModules>) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Share media',
    description: 'Shares media items on an established connection. The media itself travels out of band.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async shareMedia(@Body() body: ShareMediaBodyDto): Promise<SentMessageDto> {
    await connectionOf(this.agent, body.connectionId)

    const items = body.items.map(item => new SharedMediaItem(item))
    const record = await this.agent.modules.media.create({
      connectionId: body.connectionId,
      parentThreadId: body.threadId,
      description: body.description,
      items,
    })
    const { messageId } = await this.agent.modules.media.shareWithMessageId({
      recordId: record.id,
      parentThreadId: body.threadId,
      description: body.description,
      items,
    })

    return { id: messageId }
  }
}
