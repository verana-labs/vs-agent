import { Body, Controller, Headers, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common'
import { EventEnvelope, UnknownEventEnvelope } from '@verana-labs/vs-agent-client'

import { EventsService } from './events.service'
import { EVENTS_MODULE_OPTIONS } from './tokens'
import { EventsModuleOptions } from './types'

@Controller()
export class EventsController {
  constructor(
    @Inject(EVENTS_MODULE_OPTIONS) private readonly options: EventsModuleOptions,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  @Post('events')
  @HttpCode(204)
  public async receive(
    @Body() envelope: EventEnvelope | UnknownEventEnvelope,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    const { webhookApiKey } = this.options
    if (webhookApiKey && authorization !== `Bearer ${webhookApiKey}`) throw new UnauthorizedException()
    await this.events.receive(envelope)
  }
}
