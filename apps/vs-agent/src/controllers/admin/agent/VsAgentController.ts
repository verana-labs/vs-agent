import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiOkResponse, getSchemaPath, ApiExtraModels } from '@nestjs/swagger'

import { AGENT_LABEL, AGENT_VERSION } from '../../../../src/config'
import { VsAgentService } from '../../../services/VsAgentService'

import { VsAgentInfoDto } from './dto'

@ApiTags('agent')
@ApiExtraModels(VsAgentInfoDto)
@Controller({ path: 'agent', version: '1' })
export class VsAgentController {
  constructor(private readonly vsAgentService: VsAgentService) {}

  @Get('/')
  @ApiOperation({
    summary: 'Get vs-agent information',
    description:
      'Returns the core configuration and status of this VS Agent instance, including the user-facing label, available endpoints, initialization state, and public DID (if set).',
  })
  @ApiOkResponse({
    description: 'Agent information retrieved successfully',
    schema: { $ref: getSchemaPath(VsAgentInfoDto) },
  })
  public async getAgentInfo(): Promise<VsAgentInfoDto> {
    const vsAgent = await this.vsAgentService.getAgent()
    return {
      label: AGENT_LABEL,
      endpoints: vsAgent.didcomm.config.endpoints,
      isInitialized: vsAgent.isInitialized,
      publicDid: vsAgent.did,
      version: AGENT_VERSION,
    }
  }
}
