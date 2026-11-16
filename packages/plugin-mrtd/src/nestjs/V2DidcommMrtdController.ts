import type { MrtdAgentModules } from '../types'
import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class RequestMrzBodyDto {
  @ApiProperty({ description: 'Connection to send the request on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string
}

export class RequestEmrtdDataBodyDto {
  @ApiProperty({ description: 'Connection to send the request on', example: 'conn-1234-5678' })
  @IsString()
  @IsNotEmpty()
  connectionId!: string

  @ApiProperty({
    description:
      'Thread id of the MRZ exchange this request follows (`threadId` of the `didcomm.mrtd.mrz-data-received` event). ' +
      'It is sent as the parent thread (`pthid`) of the request, so that the wallet reads the chip with that MRZ.',
    example: 'b2c3d4e5-6789-01ab-cdef-234567890abc',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  parentThreadId?: string
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
  public async requestMrz(@Body() body: RequestMrzBodyDto): Promise<SentMrtdMessageDto> {
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
  public async requestEmrtdData(@Body() body: RequestEmrtdDataBodyDto): Promise<SentMrtdMessageDto> {
    const { messageId } = await this.agent.modules.mrtd.requestEMrtdData({
      connectionId: body.connectionId,
      parentThreadId: body.parentThreadId,
    })

    return { id: messageId }
  }
}
