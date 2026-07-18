import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AccessMode } from '../../../security'

@ApiTags('Health')
@AccessMode('INTERNAL')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  }
}
