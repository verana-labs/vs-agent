import { QuestionAnswerService, ValidResponse } from '@credo-ts/question-answer'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'

import { SendQuestionBodyDto, SentMessageDto } from './dto'
import { connectionOf, moduleService, sendMessage } from './moduleEndpoint'

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
    const service = moduleService(agent, QuestionAnswerService, 'question-answer')
    const connection = await connectionOf(agent, body.connectionId)

    const { questionMessage, questionAnswerRecord } = await service.createQuestion(
      agent.context,
      connection.id,
      {
        question: body.question,
        detail: body.detail,
        validResponses: body.validResponses.map(response => new ValidResponse(response)),
      },
    )

    return { id: await sendMessage(agent, connection, questionMessage, questionAnswerRecord) }
  }
}
