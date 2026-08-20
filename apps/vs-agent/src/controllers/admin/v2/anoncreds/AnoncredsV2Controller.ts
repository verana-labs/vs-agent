import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../../security'

@ApiTags('v2/anoncreds')
@AccessMode('INTERNAL')
@Controller({ path: 'anoncreds', version: '2' })
export class AnoncredsV2Controller {}
