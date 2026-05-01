import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import { VtFlowsService } from './VtFlowsService'
import { StartValidationProcessDto } from './dto/start-validation-process.dto'
import { ValidateFlowDto } from './dto/validate-flow.dto'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@ApiTags('vt-flow')
@Controller({ path: 'vt-flows', version: '1' })
export class VtFlowsController {
  public constructor(private readonly service: VtFlowsService) {}

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a §5.1 Validation Process',
    description:
      'Applicant action. Runs `start-perm-vp` on-chain, opens an implicit DIDComm connection to the validator, and dispatches the vt-flow `validation-request`.',
  })
  @ApiCreatedResponse({ type: VtFlowRecordDto })
  public startValidationProcess(@Body() body: StartValidationProcessDto): Promise<VtFlowRecordDto> {
    return this.service.startValidationProcess(body)
  }

  @Post(':vtFlowRecordId/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a request and offer the credential',
    description:
      'Validator action. Signs the credential, broadcasts `set-perm-vp-validated` and `createOrUpdatePermissionSession`, then dispatches the Issue Credential V2 offer.',
  })
  @ApiParam({ name: 'vtFlowRecordId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  public validate(
    @Param('vtFlowRecordId') vtFlowRecordId: string,
    @Body() body: ValidateFlowDto,
  ): Promise<VtFlowRecordDto> {
    return this.service.validateAndOfferCredential(vtFlowRecordId, body)
  }

  @Post(':vtFlowRecordId/accept-credential')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the offered credential',
    description: 'Applicant action. Sends Issue Credential V2 ack to complete the flow.',
  })
  @ApiParam({ name: 'vtFlowRecordId', type: String })
  @ApiOkResponse({ type: VtFlowRecordDto })
  @ApiNotFoundResponse()
  public acceptCredential(@Param('vtFlowRecordId') vtFlowRecordId: string): Promise<VtFlowRecordDto> {
    return this.service.acceptCredential(vtFlowRecordId)
  }
}
