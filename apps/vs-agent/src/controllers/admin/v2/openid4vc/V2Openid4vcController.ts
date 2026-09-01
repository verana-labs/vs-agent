import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

@ApiTags('v2/openid4vc')
@Controller({ path: 'openid4vc', version: '2' })
export class V2Openid4vcController {}
