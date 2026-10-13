import { DidCommHandshakeProtocol } from '@credo-ts/didcomm'
import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ecsServiceClaims } from '@verana-labs/vs-agent-sdk'

import { UrlShorteningService } from '../../../../services/UrlShorteningService'
import { VsAgentService } from '../../../../services/VsAgentService'

import { CreateOutOfBandInvitationBodyDto, CreateOutOfBandInvitationResponseDto } from './dto'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/out-of-band', version: '2' })
export class V2DidcommOutOfBandController {
  public constructor(
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
    @Inject(UrlShorteningService) private readonly urlShortenerService: UrlShorteningService,
  ) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Create an out-of-band invitation',
    description:
      'Mints a connection invitation that a peer accepts out of band (QR code, link). The agent keeps ' +
      'the Out-of-Band record, so a peer that already holds a connection answers with a handshake ' +
      'reuse, reported by the `didcomm.out-of-band.handshake-reused` event, and a new peer opens a ' +
      'connection that carries the record id as `outOfBandId`. The caller correlates both through ' +
      'the returned `invitationId`.',
  })
  @ApiCreatedResponse({ description: 'The invitation', type: CreateOutOfBandInvitationResponseDto })
  @ApiBadRequestResponse({ description: 'The body fails validation' })
  public async createInvitation(
    @Body() body: CreateOutOfBandInvitationBodyDto,
  ): Promise<CreateOutOfBandInvitationResponseDto> {
    const agent = await this.vsAgentService.getAgent()

    const didCommVersion = body.didcommVersion ?? 'v1'
    const claims = await ecsServiceClaims(agent)
    const label = body.label ?? claims?.name
    const imageUrl = body.imageUrl ?? claims?.logoUri

    const outOfBandRecord = await agent.didcomm.oob.createInvitation({
      didCommVersion,
      multiUseInvitation: body.multiUse ?? false,
      goal: body.goal,
      goalCode: body.goalCode,
      ...(didCommVersion === 'v2'
        ? { ourDid: agent.did }
        : {
            label,
            imageUrl,
            handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
            invitationDid: agent.did,
          }),
    })

    const { outOfBandInvitation } = outOfBandRecord
    const invitation = (outOfBandInvitation.v2Invitation?.toJSON() ?? outOfBandInvitation.toJSON()) as Record<
      string,
      unknown
    >
    const url = outOfBandInvitation.toUrl({ domain: agent.publicApiBaseUrl })

    const response: CreateOutOfBandInvitationResponseDto = {
      outOfBandId: outOfBandRecord.id,
      invitationId: outOfBandInvitation.v2Invitation?.id ?? outOfBandInvitation.id,
      invitation,
      url,
    }

    if (body.shortUrl) {
      const shortUrlId = await this.urlShortenerService.createShortUrl({
        invitation,
        relatedFlowId: outOfBandRecord.id,
      })
      response.shortUrl = `${agent.publicApiBaseUrl}/s?id=${shortUrlId}`
    }

    return response
  }
}
