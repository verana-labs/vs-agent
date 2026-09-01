import { Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

@ApiTags('v2/didcomm')
@Controller({ path: 'didcomm', version: '2' })
export class V2DidcommController {}
