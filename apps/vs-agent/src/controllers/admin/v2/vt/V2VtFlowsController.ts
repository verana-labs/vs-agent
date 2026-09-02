import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query } from '@nestjs/common'
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { Page } from '../../../../common'
import { VtFlowsService } from '../../vt-flow/VtFlowsService'
import {
  EditClaimsDto,
  ListFlowsV2QueryDto,
  RevokeFlowCredentialDto,
  SendOobLinkDto,
} from '../../vt-flow/dto/flow-requests.dto'
import { VtFlowRecordDto } from '../../vt-flow/dto/vt-flow-record.dto'

import { V2VtFlowRecordDto, V2VtFlowRecordPageDto } from './dto'

@ApiTags('v2/vt')
@Controller({ path: 'vt/flows', version: '2' })
export class V2VtFlowsController {
  public constructor(@Inject(VtFlowsService) private readonly service: VtFlowsService) {}

  @Get()
  @ApiOperation({
    summary: 'List credential-acquisition flows',
    description: 'Lists flows handled by the agent, with optional role, state, peer, and identifier filters.',
  })
  @ApiOkResponse({ type: V2VtFlowRecordPageDto })
  public listFlows(@Query() query: ListFlowsV2QueryDto): Promise<Page<V2VtFlowRecordDto>> {
    return this.service.listFlowsPage(query)
  }

  @Get(':participantSessionId')
  @ApiOperation({
    summary: 'Get one credential-acquisition flow',
    description: 'Returns one flow record, in the shape that listFlows returns.',
  })
  @ApiParam({
    name: 'participantSessionId',
    type: String,
    description: 'DIDComm session identifier of the target flow',
  })
  @ApiOkResponse({ type: V2VtFlowRecordDto })
  @ApiNotFoundResponse({
    description: 'No flow with the given participantSessionId',
  })
  public getFlow(@Param('participantSessionId') participantSessionId: string): Promise<V2VtFlowRecordDto> {
    return this.service.getFlow(participantSessionId)
  }

  @Put(':participantSessionId/claims')
  @ApiOperation({
    summary: 'Edit the credential claims of a flow',
    description:
      'Validator action. Replaces the credential claims stored on the flow before the credential is offered.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: Object, description: 'The updated claim set' })
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  public async editCredentialClaims(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: EditClaimsDto,
  ): Promise<Record<string, unknown>> {
    const record = await this.service.editCredentialClaims(participantSessionId, body.claims)
    return record.claims ?? {}
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
  @ApiConflictResponse()
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
  @ApiConflictResponse()
  public validateFlow(@Param('participantSessionId') participantSessionId: string): Promise<VtFlowRecordDto> {
    return this.service.validateAndOfferCredential(participantSessionId)
  }

  @Post(':participantSessionId/revoke-credential')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke the credential issued for a flow',
    description:
      'Validator action. Revokes the AnonCreds credential through its revocation registry and notifies the applicant over DIDComm.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  public revokeFlowCredential(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: RevokeFlowCredentialDto,
  ): Promise<VtFlowRecordDto> {
    return this.service.revokeFlowCredential(participantSessionId, body.reason)
  }
}
