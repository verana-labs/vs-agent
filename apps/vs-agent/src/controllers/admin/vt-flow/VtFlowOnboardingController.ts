import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'

import {
  VtFlowOnboardRequest,
  VtFlowOnboardResponse,
  VtFlowOnboardingService,
} from './VtFlowOnboardingService'

/** Admin API to start and poll an Applicant-side vt-flow session. */
@ApiTags('vt-flow')
@Controller({ path: 'vt/onboard', version: '1' })
export class VtFlowOnboardingController {
  private readonly logger = new Logger(VtFlowOnboardingController.name)

  public constructor(private readonly service: VtFlowOnboardingService) {}

  @Post()
  @ApiOperation({
    summary: 'Start an Applicant-side vt-flow session against a remote Validator.',
  })
  @ApiBody({
    schema: {
      example: {
        validatorDid: 'did:webvh:ecs-trust-registry.testnet.verana.network',
        permId: '123',
        agentPermId: 'agent-perm-42',
        walletAgentPermId: 'wallet-agent-perm-42',
        schemaBaseId: 'organization',
        claims: {
          name: 'Example Organization',
          country: 'CH',
        },
      },
    },
  })
  public async startOnboarding(@Body() body: VtFlowOnboardRequest): Promise<VtFlowOnboardResponse> {
    this.logger.log(`[vt-flow] POST /v1/vt/onboard schemaBaseId=${body.schemaBaseId}`)
    return this.service.startOnboarding(body)
  }

  /** Poll a session; returns `state === "COMPLETED"` on success. */
  @Get(':vtFlowRecordId')
  @ApiOperation({ summary: 'Fetch the current state of a vt-flow session.' })
  public async getState(@Param('vtFlowRecordId') vtFlowRecordId: string): Promise<VtFlowOnboardResponse> {
    return this.service.getState(vtFlowRecordId)
  }
}
