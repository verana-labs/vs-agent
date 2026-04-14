import { DynamicModule, Module } from '@nestjs/common'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  ConnectionController,
  CredentialTypesController,
  CredentialTypesService,
  HealthController,
  InvitationController,
  PresentationsController,
  QrController,
  TrustController,
  TrustService,
  VsAgentController,
} from './controllers'
import { VsAgentNestPlugin } from './plugins'
import { UrlShorteningService } from './services/UrlShorteningService'
import { VsAgentService } from './services/VsAgentService'

@Module({})
export class VsAgentModule {
  static register(
    agent: VsAgent,
    publicApiBaseUrl: string,
    nestPlugins: VsAgentNestPlugin[] = [],
  ): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }

    const baseControllers = [
      VsAgentController,
      CredentialTypesController,
      HealthController,
      InvitationController,
      QrController,
      TrustController,
      ConnectionController,
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

    return {
      module: VsAgentModule,
      imports: nestPlugins.flatMap(p => p.imports ?? []),
      controllers: [...baseControllers, ...nestPlugins.flatMap(p => p.controllers ?? [])],
      providers: [...baseProviders, ...nestPlugins.flatMap(p => p.providers ?? [])],
      exports: [VsAgentService],
    }
  }
}
