import { DynamicModule, Module } from '@nestjs/common'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

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

@Module({})
export class VsAgentModule {
  static register(agent: VsAgent, publicApiBaseUrl: string, mode: 'vtc' | 'didcomm' = 'didcomm'): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }

    const baseControllers = [
      VsAgentController,
      CredentialTypesController,
      HealthController,
      InvitationController,
      QrController,
      TrustController,
    ]

    const didcommControllers = [
      ConnectionController,
      MessageController,
      PresentationsController,
    ]

    const baseProviders = [
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
      TrustService,
      CredentialTypesService,
    ]

    const didcommProviders = [
      MessageService,
      RedisMessageService,
      CoreMessageService,
      MessageServiceFactory,
    ]

    return {
      module: VsAgentModule,
      imports: mode === 'didcomm' ? [HandledRedisModule.forRoot()] : [],
      controllers: mode === 'didcomm'
        ? [...baseControllers, ...didcommControllers]
        : baseControllers,
      providers: mode === 'didcomm'
        ? [...baseProviders, ...didcommProviders]
        : baseProviders,
      exports: [VsAgentService],
    }
  }
}
