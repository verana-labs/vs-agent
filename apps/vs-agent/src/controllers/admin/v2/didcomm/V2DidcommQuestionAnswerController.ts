import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'

import { SendQuestionBodyDto, SentMessageDto } from './dto'
import { chatModuleApi, connectionOf } from './moduleEndpoint'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/question-answer', version: '2' })
export class V2DidcommQuestionAnswerController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send a question',
    description: 'Asks the peer a question with a fixed set of answers.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendQuestion(@Body() body: SendQuestionBodyDto): Promise<SentMessageDto> {
    const agent = await this.vsAgentService.getAgent()
    const api = chatModuleApi(agent, 'questionAnswer', 'question-answer')
    await connectionOf(agent, body.connectionId)

    const record = await api.sendQuestion(body.connectionId, {
      question: body.question,
      detail: body.detail,
      validResponses: body.validResponses,
    })

    return { id: record.threadId }
  }
}
