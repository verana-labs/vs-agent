import { DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  V1ConnectionController,
  V1CredentialExchangesController,
  V1CredentialTypesController,
  CredentialTypesService,
  V1HealthController,
  V1InvitationController,
  V1PresentationsController,
  V1QrController,
  V1ServiceEndpointsController,
  ServiceEndpointsService,
  V1TrustController,
  TrustService,
  V2AgentController,
  V2AnoncredsController,
  V2AnoncredsCredentialDefinitionsController,
  V2AuthController,
  V2DidcommConnectionsController,
  V2DidcommController,
  V2DidcommPresentationsController,
  V2Openid4vcController,
  V2VtServiceEndpointsController,
  V1VsAgentController,
  MESSAGE_HANDLERS,
} from './controllers'
import { BOOTSTRAP_STATE, BootstrapState } from './common'
import { AdminAuthGuard, AdminAuthService, V1AuthController } from './security'
import { UrlShorteningService } from './services/UrlShorteningService'
import { VsAgentService } from './services/VsAgentService'

@Module({})
export class VsAgentModule {
  static register(
    agent: VsAgent,
    publicApiBaseUrl: string,
    nestPlugins: VsAgentNestPlugin[] = [],
    options: { external?: boolean; allowedAccounts?: string[]; bootstrapState?: BootstrapState } = {},
  ): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }
    const bootstrapState = options.bootstrapState ?? new BootstrapState()

    const baseControllers = [
      V1VsAgentController,
      V1CredentialTypesController,
      V1CredentialExchangesController,
      V1HealthController,
      V1InvitationController,
      V1QrController,
      V1TrustController,
      V1ConnectionController,
      V1PresentationsController,
      V1ServiceEndpointsController,
    ]

    const v2Controllers = [
      V2AuthController,
      V2AgentController,
      V2DidcommController,
      V2DidcommPresentationsController,
      V2DidcommConnectionsController,
      V2Openid4vcController,
      V2AnoncredsController,
      V2AnoncredsCredentialDefinitionsController,
      V2VtServiceEndpointsController,
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
      {
        provide: BOOTSTRAP_STATE,
        useFactory: () => bootstrapState,
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

    const securityControllers = options.external ? [V1AuthController] : []
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
        ...v2Controllers,
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
