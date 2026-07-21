import { DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  ConnectionController,
  CredentialExchangesController,
  CredentialTypesController,
  CredentialTypesService,
  HealthController,
  InvitationController,
  PresentationsController,
  QrController,
  ServiceEndpointsController,
  ServiceEndpointsService,
  TrustController,
  TrustService,
  VsAgentController,
  MESSAGE_HANDLERS,
} from './controllers'
import { AdminAuthGuard, AdminAuthService, AuthController } from './security'
import { UrlShorteningService } from './services/UrlShorteningService'
import { VsAgentService } from './services/VsAgentService'

@Module({})
export class VsAgentModule {
  static register(
    agent: VsAgent,
    publicApiBaseUrl: string,
    nestPlugins: VsAgentNestPlugin[] = [],
    options: { external?: boolean; allowedAccounts?: string[] } = {},
  ): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }

    const baseControllers = [
      VsAgentController,
      CredentialTypesController,
      CredentialExchangesController,
      HealthController,
      InvitationController,
      QrController,
      TrustController,
      ConnectionController,
      PresentationsController,
      ServiceEndpointsController,
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
      ServiceEndpointsService,
    ]

    // Collect all handler classes declared by plugins and create ONE aggregate provider.
    const allHandlerClasses = nestPlugins.flatMap(p => p.messageHandlers ?? [])
    const handlersProvider = {
      provide: MESSAGE_HANDLERS,
      useFactory: (...handlers: any[]) => handlers,
      inject: allHandlerClasses,
    }

    const securityControllers = options.external ? [AuthController] : []
    const securityProviders = options.external
      ? [
          AdminAuthService,
          { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: options.allowedAccounts ?? [] },
          { provide: APP_GUARD, useClass: AdminAuthGuard },
        ]
      : []

    return {
      module: VsAgentModule,
      imports: nestPlugins.flatMap(p => p.imports ?? []),
      controllers: [
        ...baseControllers,
        ...securityControllers,
        ...nestPlugins.flatMap(p => p.controllers ?? []),
      ],
      providers: [
        ...baseProviders,
        ...securityProviders,
        ...nestPlugins.flatMap(p => p.providers ?? []),
        handlersProvider,
      ],
      exports: [VsAgentService],
    }
  }
}
