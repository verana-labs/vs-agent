import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

@ApiTags('v2/didcomm')
@AccessMode('INTERNAL')
@Controller({ path: 'didcomm', version: '2' })
export class V2DidcommController {}
