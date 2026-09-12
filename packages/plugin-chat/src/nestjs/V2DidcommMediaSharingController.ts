import { DidCommMediaSharingService, SharedMediaItem } from '@2060.io/credo-ts-didcomm-media-sharing'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'

import { SentMessageDto, ShareMediaBodyDto } from './dto'
import { connectionOf, moduleService, sendMessage } from './moduleEndpoint'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/media-sharing', version: '2' })
export class V2DidcommMediaSharingController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Share media',
    description: 'Shares media items on an established connection. The media itself travels out of band.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async shareMedia(@Body() body: ShareMediaBodyDto): Promise<SentMessageDto> {
    const agent = await this.vsAgentService.getAgent()
    const service = moduleService(agent, DidCommMediaSharingService, 'media-sharing')
    const connection = await connectionOf(agent, body.connectionId)

    const items = body.items.map(item => new SharedMediaItem(item))
    const record = await service.createRecord(agent.context, {
      connectionRecord: connection,
      parentThreadId: body.threadId,
      description: body.description,
      items,
    })
    const { message } = await service.createMediaShare(agent.context, {
      record,
      parentThreadId: body.threadId,
      description: body.description,
      items,
    })

    return { id: await sendMessage(agent, connection, message, record) }
  }
}
