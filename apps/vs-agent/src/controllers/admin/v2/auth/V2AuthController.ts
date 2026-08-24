import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

@ApiTags('v2/auth')
@Controller({ path: 'auth', version: '2' })
export class V2AuthController {}
