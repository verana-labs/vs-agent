import { Module } from '@nestjs/common'

import { V1HealthController } from './v1-health.controller'

@Module({
  controllers: [V1HealthController],
})
export class HealthModule {}
