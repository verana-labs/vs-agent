import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

@ApiTags('v2/agent')
@AccessMode('INTERNAL')
@Controller({ path: 'agent', version: '2' })
export class AgentV2Controller {}
