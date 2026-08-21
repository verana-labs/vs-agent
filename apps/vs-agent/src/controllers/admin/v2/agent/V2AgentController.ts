import { Controller, Get, HttpStatus, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger'

import { AdminApiError, AdminApiErrorCode, BOOTSTRAP_STATE, BootstrapState } from '../../../../common'
import { AccessMode } from '../../../../security'

import { LivenessDto, ReadinessDto } from './health.dto'

@ApiTags('v2/agent')
@AccessMode('INTERNAL')
@Controller({ path: 'agent', version: '2' })
export class V2AgentController {
  public constructor(@Inject(BOOTSTRAP_STATE) private readonly bootstrapState: BootstrapState) {}

  @Get('health/live')
  @AccessMode('PUBLIC')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers as soon as the HTTP listener accepts a connection. Never fails because an external dependency failed.',
  })
  @ApiOkResponse({ description: 'The agent process is alive', type: LivenessDto })
  public getLiveness(): LivenessDto {
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
