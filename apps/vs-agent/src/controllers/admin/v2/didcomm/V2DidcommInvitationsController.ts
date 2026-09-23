import { Body, Controller, Inject, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { SendInvitationBodyDto, SendInvitationResponseDto } from './dto'
import { InvitationsService } from './InvitationsService'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm/invitations', version: '2' })
export class V2DidcommInvitationsController {
  public constructor(@Inject(InvitationsService) private readonly invitationsService: InvitationsService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Send an invitation',
    description:
      'Sends an Out-of-Band invitation on an established connection. A v1 connection carries the ' +
      'Out-of-Band 1.1 message. A v2 connection carries the Out-of-Band 2.0 invitation in the ' +
      '`application/didcomm-plain+json` attachment of a Media Sharing share-media message. Without ' +
      '`did`, the invitation opens a single-use sub-connection to this agent, correlated through ' +
      '`parentConnectionId`. With `did`, it refers the peer to that service and creates no record.',
  })
  @ApiBody({
    type: SendInvitationBodyDto,
    examples: {
      subConnection: {
        summary: 'Sub-connection to this agent',
        value: {
          connectionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          label: 'Support',
          imageUrl: 'https://example.com/support.png',
          goal: 'Open a support chat',
          goalCode: 'support-chat',
        },
      },
      referral: {
        summary: 'Referral to another service',
        value: {
          connectionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          did: 'did:webvh:QmbfsYcjFS2bnouwXBSoZZ65jREEgZGSPdcatcwY7i1Gq2:verifier.example.com',
          goal: 'Verify your identity',
          goalCode: 'identity-verification',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'The invitation is sent', type: SendInvitationResponseDto })
  @ApiBadRequestResponse({ description: 'The body fails validation' })
  @ApiNotFoundResponse({ description: 'No connection with the given id' })
  public async sendInvitation(@Body() body: SendInvitationBodyDto): Promise<SendInvitationResponseDto> {
    return this.invitationsService.sendInvitation(body)
  }
}
