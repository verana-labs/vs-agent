import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

@ApiTags('v2/auth')
@AccessMode('INTERNAL')
@Controller({ path: 'auth', version: '2' })
export class V2AuthController {}
