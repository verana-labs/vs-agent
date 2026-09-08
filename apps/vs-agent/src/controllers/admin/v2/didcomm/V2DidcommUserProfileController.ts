import {
  DidCommUserProfileData,
  DidCommUserProfileKey,
  DidCommUserProfileService,
} from '@2060.io/credo-ts-didcomm-user-profile'
import { Body, Controller, HttpStatus, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode } from '../../../../common'
import { VsAgentService } from '../../../../services/VsAgentService'

import { RequestProfileBodyDto, SendProfileBodyDto, SentMessageDto } from './dto'
import { connectionOf, moduleService, sendMessage } from './moduleEndpoint'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/user-profile', version: '2' })
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class V2DidcommUserProfileController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Post('send')
  @ApiOperation({
    summary: 'Send a profile',
    description: 'Sends a profile on an established connection, the stored one when the body omits it.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async sendProfile(@Body() body: SendProfileBodyDto): Promise<SentMessageDto> {
    const agent = await this.vsAgentService.getAgent()
    const service = moduleService(agent, DidCommUserProfileService, 'user-profile')
    const connection = await connectionOf(agent, body.connectionId)

    const profile = (body.profile as DidCommUserProfileData | undefined) ?? (await stored(service, agent))
    if (!profile) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        HttpStatus.CONFLICT,
        'the agent stores no profile values',
      )
    }

    const message = await service.createProfileMessage({
      profile,
      threadId: body.threadId,
      sendBackYours: body.sendBackYours,
    })

    return { id: await sendMessage(agent, connection, message) }
  }

  @Post('request')
  @ApiOperation({
    summary: 'Request a profile',
    description: 'Asks the peer of a connection for its profile.',
  })
  @ApiCreatedResponse({ description: 'The sent message', type: SentMessageDto })
  @ApiNotFoundResponse({ description: 'No connection with the given id, or the module is not served' })
  public async requestProfile(@Body() body: RequestProfileBodyDto): Promise<SentMessageDto> {
    const agent = await this.vsAgentService.getAgent()
    const service = moduleService(agent, DidCommUserProfileService, 'user-profile')
    const connection = await connectionOf(agent, body.connectionId)

    const message = await service.createRequestProfileMessage({
      query: body.query as DidCommUserProfileKey[] | undefined,
    })

    return { id: await sendMessage(agent, connection, message) }
  }
}

async function stored(
  service: DidCommUserProfileService,
  agent: Awaited<ReturnType<VsAgentService['getAgent']>>,
): Promise<DidCommUserProfileData | undefined> {
  const record = await service.getUserProfile(agent.context)
  const profile: DidCommUserProfileData = {
    displayName: record.displayName,
    displayPicture: record.displayPicture,
    displayIcon: record.displayIcon,
    description: record.description,
    preferredLanguage: record.preferredLanguage,
  }

  return Object.values(profile).some(value => value !== undefined && value !== null && value !== '')
    ? profile
    : undefined
}
