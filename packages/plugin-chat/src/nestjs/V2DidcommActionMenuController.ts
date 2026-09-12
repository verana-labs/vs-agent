import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

import type { AgentContext, BaseRecord } from '@credo-ts/core'
import type { DidCommConnectionRecord, DidCommMessage } from '@credo-ts/didcomm'

import { ActionMenu, ActionMenuApi } from '@credo-ts/action-menu'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { SendMenuBodyDto, SentMessageDto } from './dto'
import { connectionOf, moduleService, sendMessage } from '@verana-labs/vs-agent-sdk'

interface MenuCreator {
  createMenu(
    agentContext: AgentContext,
    options: { connection: DidCommConnectionRecord; menu: ActionMenu },
  ): Promise<{ message: DidCommMessage; record: BaseRecord<any, any, any> }>
}

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/action-menu', version: '2' })
export class V2DidcommActionMenuController {
  public constructor(@Inject('VSAGENT') private readonly vsAgent: VsAgent<BaseAgentModules>) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({ summary: 'Send a menu', description: 'Sends a menu on an established connection.' })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendMenu(@Body() body: SendMenuBodyDto): Promise<SentMessageDto> {
    const agent = await this.agent()
    const api = moduleService(agent, ActionMenuApi, 'action-menu')
    const connection = await connectionOf(agent, body.connectionId)

    const service = (api as unknown as { actionMenuService: MenuCreator }).actionMenuService
    const { message, record } = await service.createMenu(agent.context, {
      connection,
      menu: new ActionMenu(body.menu),
    })

    return { id: await sendMessage(agent, connection, message, record) }
  }

  private async agent(): Promise<VsAgent<BaseAgentModules>> {
    if (!this.vsAgent.isInitialized) await this.vsAgent.initialize()
    return this.vsAgent
  }
}
