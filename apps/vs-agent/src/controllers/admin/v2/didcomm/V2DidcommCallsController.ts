import { DidCommCallsService, DidCommCallType } from '@2060.io/credo-ts-didcomm-calls'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'

import { AcceptCallBodyDto, CallThreadBodyDto, OfferCallBodyDto, SentMessageDto } from './dto'
import { connectionOf, moduleService, sendMessage } from './moduleEndpoint'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/calls', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2DidcommCallsController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post()
  @ApiOperation({ summary: 'Offer a call', description: 'Offers a call on an established connection.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async offerCall(@Body() body: OfferCallBodyDto): Promise<SentMessageDto> {
    const { agent, service, connection } = await this.callsContext(body.connectionId)
    const message = service.createOffer({
      callType: body.callType as DidCommCallType,
      parameters: body.parameters,
      description: body.description,
      offerStartTime: body.offerStartTime ? new Date(body.offerStartTime) : undefined,
      offerExpirationTime: body.offerExpirationTime ? new Date(body.offerExpirationTime) : undefined,
    })

    return { id: await sendMessage(agent, connection, message) }
  }

  @Post('accept')
  @ApiOperation({ summary: 'Accept a call', description: 'Accepts a call that a peer offered.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async acceptCall(@Body() body: AcceptCallBodyDto): Promise<SentMessageDto> {
    const { agent, service, connection } = await this.callsContext(body.connectionId)
    const message = service.createAccept({ threadId: body.threadId, parameters: body.parameters })

    return { id: await sendMessage(agent, connection, message) }
  }

  @Post('reject')
  @ApiOperation({ summary: 'Reject a call', description: 'Rejects a call that a peer offered.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async rejectCall(@Body() body: CallThreadBodyDto): Promise<SentMessageDto> {
    const { agent, service, connection } = await this.callsContext(body.connectionId)
    const message = service.createReject({ threadId: body.threadId })

    return { id: await sendMessage(agent, connection, message) }
  }

  @Post('end')
  @ApiOperation({ summary: 'End a call', description: 'Ends a call.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async endCall(@Body() body: CallThreadBodyDto): Promise<SentMessageDto> {
    const { agent, service, connection } = await this.callsContext(body.connectionId)
    const message = service.createEnd({ threadId: body.threadId })

    return { id: await sendMessage(agent, connection, message) }
  }

  private async callsContext(connectionId: string) {
    const agent = await this.vsAgentService.getAgent()
    const service = moduleService(agent, DidCommCallsService, 'calls')

    return { agent, service, connection: await connectionOf(agent, connectionId) }
  }
}
