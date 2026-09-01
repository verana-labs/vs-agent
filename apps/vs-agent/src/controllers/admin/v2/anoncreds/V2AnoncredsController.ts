import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

@ApiTags('v2/anoncreds')
@Controller({ path: 'anoncreds', version: '2' })
export class V2AnoncredsController {}
