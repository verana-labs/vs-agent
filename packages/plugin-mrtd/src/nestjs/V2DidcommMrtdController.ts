import { DidCommMrtdApi, DidCommMrtdService } from '@2060.io/credo-ts-didcomm-mrtd'
import { Body, Controller, Inject, NotFoundException, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { VsAgent } from '@verana-labs/vs-agent-sdk'
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
  public constructor(@Inject('VSAGENT') private readonly agent: VsAgent<any>) {}

  @Post('request-mrz')
  @ApiOperation({
    summary: 'Request an MRZ',
    description: 'Asks the peer for the machine-readable zone of its travel document.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMrtdMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async requestMrz(@Body() body: RequestMrtdBodyDto): Promise<SentMrtdMessageDto> {
    const api = await this.mrtdApi(body.connectionId)
    const { messageId } = await api.requestMrzString({ connectionId: body.connectionId })

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
    const api = await this.mrtdApi(body.connectionId)
    const { messageId } = await api.requestEMrtdData({ connectionId: body.connectionId })

    return { id: messageId }
  }

  private async mrtdApi(connectionId: string): Promise<DidCommMrtdApi> {
    if (!this.agent.isInitialized) await this.agent.initialize()

    const { dependencyManager } = this.agent.context
    if (!dependencyManager.isRegistered(DidCommMrtdService)) {
      throw new NotFoundException('this deployment does not serve the mrtd module')
    }
    if (!(await this.agent.didcomm.connections.findById(connectionId))) {
      throw new NotFoundException(`no connection with id "${connectionId}"`)
    }

    return dependencyManager.resolve(DidCommMrtdApi)
  }
}
