import { Controller, Get, HttpStatus, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode, BOOTSTRAP_STATE, BootstrapState } from '../../../../common'
import { AGENT_VERSION } from '../../../../config'
import { AccessMode } from '../../../../security'
import { VsAgentService } from '../../../../services/VsAgentService'

import { AgentInfoDto, LivenessDto, ReadinessDto } from './dto'

@ApiTags('v2/agent')
@AccessMode('INTERNAL')
@Controller({ path: 'agent', version: '2' })
export class V2AgentController {
  public constructor(
    @Inject(BOOTSTRAP_STATE) private readonly bootstrapState: BootstrapState,
    @Inject(VsAgentService) private readonly vsAgentService: VsAgentService,
  ) {}

  @Get('info')
  @AccessMode('CORPORATION')
  @ApiOperation({
    summary: 'Get agent information',
    description: 'Identifies this VS Agent instance by the DID it created on its first startup.',
  })
  @ApiOkResponse({ description: 'The agent identified itself', type: AgentInfoDto })
  public async getAgentInfo(): Promise<AgentInfoDto> {
    const agent = await this.vsAgentService.getAgent()

    return { did: agent.did, version: AGENT_VERSION }
  }

  @Get('health/live')
  @AccessMode('PUBLIC')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers as soon as the HTTP listener accepts a connection. Never fails because an external dependency failed.',
  })
  @ApiOkResponse({ description: 'The agent process is alive', type: LivenessDto })
  @ApiServiceUnavailableResponse({ description: 'A bootstrap step failed beyond recovery' })
  public getLiveness(): LivenessDto {
    const { live, message } = this.bootstrapState.liveness

    if (!live) {
      throw new AdminApiError(
        AdminApiErrorCode.Internal,
        HttpStatus.SERVICE_UNAVAILABLE,
        message ?? 'the agent cannot recover without a restart',
      )
    }

    return { status: 'live' }
  }

  @Get('health/ready')
  @AccessMode('PUBLIC')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Answers 200 once every bootstrap step completed and the agent is up to date with the indexer.',
  })
  @ApiOkResponse({ description: 'The agent is ready to serve', type: ReadinessDto })
  @ApiServiceUnavailableResponse({ description: 'A bootstrap step is still pending' })
  public getReadiness(): ReadinessDto {
    const { ready, message } = this.bootstrapState.readiness

    if (!ready) {
      throw new AdminApiError(
        AdminApiErrorCode.NotReady,
        HttpStatus.SERVICE_UNAVAILABLE,
        message ?? 'the agent is not ready',
      )
    }

    return { status: 'ready' }
  }
}
