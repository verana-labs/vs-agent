import { Body, Controller, Get, Inject, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { createdAtKey, mapPage, Page, paginate } from '../../../../common'
import { VsAgentService } from '../../../../services/VsAgentService'

import {
  BasicMessageRecordDto,
  BasicMessageRecordPageDto,
  ListBasicMessagesQueryDto,
  SendBasicMessageBodyDto,
  SentMessageDto,
} from './dto'
import { toBasicMessageDto } from './mappers'
import { connectionOf } from '@verana-labs/vs-agent-sdk'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/basic-messages', version: '2' })
export class V2DidcommBasicMessagesController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send a basic message',
    description: 'Sends a text message on an established connection.',
  })
  @ApiCreatedResponse({ description: 'The message record', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async sendBasicMessage(@Body() body: SendBasicMessageBodyDto): Promise<SentMessageDto> {
    const agent = await this.vsAgentService.getAgent()
    await connectionOf(agent, body.connectionId)

    const record = await agent.didcomm.basicMessages.sendMessage(body.connectionId, body.content)

    return { id: record.id }
  }

  @Get()
  @ApiOperation({
    summary: 'List basic messages',
    description: 'Returns the message records, filtered when the caller supplies a filter.',
  })
  @ApiOkResponse({ description: 'A page of message records', type: BasicMessageRecordPageDto })
  public async listBasicMessages(
    @Query() query: ListBasicMessagesQueryDto,
  ): Promise<Page<BasicMessageRecordDto>> {
    const agent = await this.vsAgentService.getAgent()

    const filters = { connectionId: query.connectionId, role: query.role }
    const records = await agent.didcomm.basicMessages.findAllByQuery(filters)
    const page = paginate(records, query, { method: 'listBasicMessages', filters }, createdAtKey)

    return mapPage(page, toBasicMessageDto)
  }
}
