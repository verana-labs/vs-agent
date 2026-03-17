import { DynamicModule, Module } from '@nestjs/common'

import {
  ConnectionController,
  CoreMessageService,
  CredentialTypesController,
  CredentialTypesService,
  HealthController,
  InvitationController,
  MessageController,
  MessageService,
  MessageServiceFactory,
  PresentationsController,
  QrController,
  RedisMessageService,
  TrustController,
  TrustService,
  VsAgentController,
} from './controllers'
import { HandledRedisModule } from './modules/redis.module'
import { UrlShorteningService } from './services/UrlShorteningService'
import { VsAgentService } from './services/VsAgentService'
import { VsAgent } from './utils'

@Module({})
export class VsAgentModule {
  static register(agent: VsAgent, publicApiBaseUrl: string): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }
    return {
      module: VsAgentModule,
      imports: [HandledRedisModule.forRoot()],
      controllers: [
        VsAgentController,
        ConnectionController,
        CredentialTypesController,
        HealthController,
        MessageController,
        PresentationsController,
        InvitationController,
        QrController,
        TrustController,
      ],
      providers: [
        {
          provide: 'VSAGENT',
          useFactory: () => agentRef.get(),
        },
        {
          provide: 'PUBLIC_API_BASE_URL',
          useFactory: () => publicApiBaseUrl,
        },
        VsAgentService,
        UrlShorteningService,
        MessageService,
        RedisMessageService,
        CoreMessageService,
        MessageServiceFactory,
        TrustService,
        CredentialTypesService,
      ],
      exports: [VsAgentService],
    }
  }
}
