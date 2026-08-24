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
import { AccessMode } from '../../../../security'
import { VtFlowsService } from '../../vt-flow/VtFlowsService'
import {
  EditClaimsDto,
  ListFlowsV2QueryDto,
  RevokeFlowCredentialDto,
  SendOobLinkDto,
} from '../../vt-flow/dto/flow-requests.dto'
import { VtFlowRecordDto, VtFlowRecordPageDto } from '../../vt-flow/dto/vt-flow-record.dto'

@ApiTags('v2/vt')
@Controller({ path: 'vt/flows', version: '2' })
export class V2VtFlowsController {
  public constructor(@Inject(VtFlowsService) private readonly service: VtFlowsService) {}

  @Get()
  @AccessMode('CORPORATION', [
    '/verana.pp.v1.MsgSetParticipantOPToValidated',
    '/verana.pp.v1.MsgStartParticipantOP',
    '/verana.pp.v1.MsgRenewParticipantOP',
  ])
  @ApiOperation({
    summary: 'List credential-acquisition flows',
    description: 'Lists flows handled by the agent, with optional role, state, peer, and identifier filters.',
  })
  @ApiOkResponse({ type: VtFlowRecordPageDto })
  public listFlows(@Query() query: ListFlowsV2QueryDto): Promise<Page<VtFlowRecordDto>> {
    return this.service.listFlowsPage(query)
  }

  @Put(':participantSessionId/claims')
  @AccessMode('CORPORATION', ['/verana.pp.v1.MsgSetParticipantOPToValidated'])
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
  @AccessMode('CORPORATION', ['/verana.pp.v1.MsgSetParticipantOPToValidated'])
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
  @AccessMode('CORPORATION', ['/verana.pp.v1.MsgSetParticipantOPToValidated'])
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
  @AccessMode('CORPORATION', ['/verana.pp.v1.MsgRevokeParticipant'])
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
