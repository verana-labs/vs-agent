import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { Page } from '../../../../common'
import { toV2Dto, VtFlowsService } from '../../vt-flow/VtFlowsService'
import {
  EditClaimsDto,
  ListFlowsV2QueryDto,
  RejectFlowDto,
  SendOobLinkV2Dto,
  StartValidationDto,
  ValidateFlowDto,
} from '../../vt-flow/dto/flow-requests.dto'

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
  @ApiOkResponse({ type: V2VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  public async sendOobLink(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: SendOobLinkV2Dto,
  ): Promise<V2VtFlowRecordDto> {
    return toV2Dto(
      await this.service.sendOobLink(participantSessionId, body.url, body.description, body.expiresAt),
    )
  }

  @Post(':participantSessionId/start-validation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a flow back to VALIDATING',
    description:
      'Validator action. Tells the applicant with a validating message once it has completed the out-of-band step.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: V2VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  public async startValidation(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: StartValidationDto,
  ): Promise<V2VtFlowRecordDto> {
    return toV2Dto(await this.service.startValidation(participantSessionId, body.comment))
  }

  @Post(':participantSessionId/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record the validation decision of a flow',
    description:
      'Validator action. Checks the claim set, records the fee terms, and submits SetParticipantOPtoValidated ' +
      'under the agent VS operator authorization, or leaves it to an operator of the Corporation. ' +
      'A transaction failure is not an error: the flow reports it in validation.tx.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: V2VtFlowRecordDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  public async validateFlow(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: ValidateFlowDto,
  ): Promise<V2VtFlowRecordDto> {
    return toV2Dto(await this.service.validateFlow(participantSessionId, body))
  }

  @Post(':participantSessionId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a flow',
    description:
      'Validator action. Sends a problem-report and moves the flow to TERMINATED_BY_VALIDATOR, ' +
      'with no on-chain transaction.',
  })
  @ApiParam({ name: 'participantSessionId', type: String })
  @ApiOkResponse({ type: V2VtFlowRecordDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  public async rejectFlow(
    @Param('participantSessionId') participantSessionId: string,
    @Body() body: RejectFlowDto,
  ): Promise<V2VtFlowRecordDto> {
    return toV2Dto(await this.service.rejectFlow(participantSessionId, body))
  }
}
