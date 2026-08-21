import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

@ApiTags('v2/vt')
@AccessMode('INTERNAL')
@Controller({ path: 'vt', version: '2' })
export class V2VtController {}
