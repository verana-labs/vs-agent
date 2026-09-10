import { DidCommFeatureQuery, DidCommProtocol } from '@credo-ts/didcomm'
import { Controller, Get, Inject } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { VsAgentService } from '../../../../services/VsAgentService'
import { DIDCOMM_MODULES } from '../../../../utils/didcommModules'

import { ProtocolModuleDto } from './dto'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm', version: '2' })
export class V2DidcommController {
  public constructor(@Inject(VsAgentService) private readonly vsAgentService: VsAgentService) {}

  @Get('protocols')
  @ApiOperation({
    summary: 'List protocols',
    description: 'Returns the protocol modules that this deployment serves.',
  })
  @ApiOkResponse({ description: 'One record per served module', type: [ProtocolModuleDto] })
  public async listProtocols(): Promise<ProtocolModuleDto[]> {
    const agent = await this.vsAgentService.getAgent()

    const registered = agent.didcomm.features
      .query(new DidCommFeatureQuery({ featureType: DidCommProtocol.type, match: '*' }))
      .map(feature => feature.id)

    return DIDCOMM_MODULES.flatMap(({ module, prefixes }) => {
      const protocols = registered.filter(id => prefixes.some(prefix => id.startsWith(prefix))).sort()
      return protocols.length > 0 ? [{ module, protocols }] : []
    })
  }
}
