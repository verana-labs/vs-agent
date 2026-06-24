import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { VtFlowsService } from './VtFlowsService'
import { VtFlowRecordDto } from './dto/vt-flow-record.dto'

@ApiTags('vt-flow')
@Controller({ path: 'vt/flows', version: '1' })
export class VtFlowsController {
  public constructor(private readonly service: VtFlowsService) {}

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
}
