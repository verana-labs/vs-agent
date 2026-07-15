import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { VtFlowsService } from './VtFlowsService'
import {
  EditClaimsDto,
  ListFlowsQueryDto,
  RevokeFlowCredentialDto,
  SendOobLinkDto,
} from './dto/flow-requests.dto'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@ApiTags('vt-flow')
@Controller({ path: 'vt/flows', version: '1' })
export class VtFlowsController {
  public constructor(private readonly service: VtFlowsService) {}

  @Get()
  @ApiOperation({
    summary: 'List credential-acquisition flows',
    description: 'Lists flows handled by the agent, with optional role, state, peer, and identifier filters.',
  })
  @ApiOkResponse({ type: [VtFlowRecordDto] })
  public listFlows(@Query() query: ListFlowsQueryDto): Promise<VtFlowRecordDto[]> {
    return this.service.listFlows(query)
  }

  @Put(':participantSessionId/claims')
  @ApiOperation({
    summary: 'Edit the credential claims of a flow',
    description:
      'Validator action. Replaces the credential claims stored on the flow before the credential is offered.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  public editCredentialClaims(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: EditClaimsDto,
  ): Promise<VtFlowRecordDto> {
    return this.service.editCredentialClaims(participantSessionId, body.claims)
  }

  @Post(':participantSessionId/oob-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an OOB_LINK message to the applicant',
    description: 'Validator action. Sends or resends an out-of-band URL for information collection.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  public sendOobLink(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: SendOobLinkDto,
  ): Promise<VtFlowRecordDto> {
    return this.service.sendOobLink(participantSessionId, body.url, body.message)
  }

  @Post(':participantSessionId/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a request and offer the credential',
    description:
      'Validator action. Marks the applicant validated and offers the credential over Issue Credential V2. The credential schema is derived from the flow state.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  public validate(@Param('participantSessionId') participantSessionId: string): Promise<VtFlowRecordDto> {
    return this.service.validateAndOfferCredential(participantSessionId)
  }

  @Post(':participantSessionId/revoke-credential')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke the credential issued for a flow',
    description: 'Validator action. Notifies the applicant over DIDComm that the credential is revoked.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  public revokeCredential(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: RevokeFlowCredentialDto,
  ): Promise<VtFlowRecordDto> {
    return this.service.revokeCredential(participantSessionId, body.reason)
  }
}
