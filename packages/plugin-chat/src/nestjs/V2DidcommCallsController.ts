import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import type { DidCommCallType } from '@2060.io/credo-ts-didcomm-calls'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AcceptCallBodyDto, CallThreadBodyDto, OfferCallBodyDto, SentMessageDto } from './dto'
import { connectionOf } from '@verana-labs/vs-agent-sdk'
import { chatModuleApi } from './chatModuleApi'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/calls', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2DidcommCallsController {
  public constructor(@Inject('VSAGENT') private readonly vsAgent: VsAgent<BaseAgentModules>) {}

  @Post()
  @ApiOperation({ summary: 'Offer a call', description: 'Offers a call on an established connection.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async offerCall(@Body() body: OfferCallBodyDto): Promise<SentMessageDto> {
    const api = await this.callsApi(body.connectionId)
    const { messageId } = await api.offer({
      connectionId: body.connectionId,
      callType: body.callType as DidCommCallType,
      parameters: body.parameters,
      description: body.description,
      offerStartTime: body.offerStartTime ? new Date(body.offerStartTime) : undefined,
      offerExpirationTime: body.offerExpirationTime ? new Date(body.offerExpirationTime) : undefined,
    })

    return { id: messageId }
  }

  @Post('accept')
  @ApiOperation({ summary: 'Accept a call', description: 'Accepts a call that a peer offered.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async acceptCall(@Body() body: AcceptCallBodyDto): Promise<SentMessageDto> {
    const api = await this.callsApi(body.connectionId)
    const { messageId } = await api.accept({
      connectionId: body.connectionId,
      threadId: body.threadId,
      parameters: body.parameters,
    })

    return { id: messageId }
  }

  @Post('reject')
  @ApiOperation({ summary: 'Reject a call', description: 'Rejects a call that a peer offered.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async rejectCall(@Body() body: CallThreadBodyDto): Promise<SentMessageDto> {
    const api = await this.callsApi(body.connectionId)
    const { messageId } = await api.reject({ connectionId: body.connectionId, threadId: body.threadId })

    return { id: messageId }
  }

  @Post('end')
  @ApiOperation({ summary: 'End a call', description: 'Ends a call.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async endCall(@Body() body: CallThreadBodyDto): Promise<SentMessageDto> {
    const api = await this.callsApi(body.connectionId)
    const { messageId } = await api.hangup({ connectionId: body.connectionId, threadId: body.threadId })

    return { id: messageId }
  }

  private async callsApi(connectionId: string) {
    const agent = await this.agent()
    const api = chatModuleApi(agent, 'calls', 'calls')
    await connectionOf(agent, connectionId)

    return api
  }

  private async agent(): Promise<VsAgent<BaseAgentModules>> {
    if (!this.vsAgent.isInitialized) await this.vsAgent.initialize()
    return this.vsAgent
  }
}
