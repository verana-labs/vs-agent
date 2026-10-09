import type { MrtdAgentModules } from '../types'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class RequestMrtdBodyDto {
  @ApiProperty({ description: 'Connection to send the request on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string
}

export class SentMrtdMessageDto {
  @ApiProperty({
    description: 'Identifier of the sent message',
    example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
  })
  id!: string
}

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/mrtd', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2DidcommMrtdController {
  public constructor(@Inject('VSAGENT') private readonly agent: VsAgent<MrtdAgentModules>) {}

  @Post('request-mrz')
  @ApiOperation({
    summary: 'Request an MRZ',
    description: 'Asks the peer for the machine-readable zone of its travel document.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMrtdMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async requestMrz(@Body() body: RequestMrtdBodyDto): Promise<SentMrtdMessageDto> {
    const { messageId } = await this.agent.modules.mrtd.requestMrzString({ connectionId: body.connectionId })

    return { id: messageId }
  }

  @Post('request-emrtd')
  @ApiOperation({
    summary: 'Request eMRTD data groups',
    description: 'Asks the peer for the data groups of its electronic travel document.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMrtdMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async requestEmrtdData(@Body() body: RequestMrtdBodyDto): Promise<SentMrtdMessageDto> {
    const { messageId } = await this.agent.modules.mrtd.requestEMrtdData({ connectionId: body.connectionId })

    return { id: messageId }
  }
}
