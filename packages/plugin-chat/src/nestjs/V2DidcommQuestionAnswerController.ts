import type { ChatAgentModules } from '../types'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { SendQuestionBodyDto, SentMessageDto } from './dto'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/question-answer', version: '2' })
export class V2DidcommQuestionAnswerController {
  public constructor(@Inject('VSAGENT') private readonly agent: VsAgent<ChatAgentModules>) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send a question',
    description: 'Asks the peer a question with a fixed set of answers.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendQuestion(@Body() body: SendQuestionBodyDto): Promise<SentMessageDto> {
    const record = await this.agent.modules.questionAnswer.sendQuestion(body.connectionId, {
      question: body.question,
      detail: body.detail,
      validResponses: body.validResponses,
    })

    return { id: record.threadId }
  }
}
