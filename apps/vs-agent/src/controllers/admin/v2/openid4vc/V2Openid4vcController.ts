import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

@ApiTags('v2/openid4vc')
@AccessMode('INTERNAL')
@Controller({ path: 'openid4vc', version: '2' })
export class V2Openid4vcController {}
