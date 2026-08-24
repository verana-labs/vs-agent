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
  V2AuthController,
  V2DidcommController,
  V2Openid4vcController,
  V2VtServiceEndpointsController,
  V1VsAgentController,
  MESSAGE_HANDLERS,
} from './controllers'
import { BOOTSTRAP_STATE, BootstrapState } from './common'
import {
  AdminAuthGuard,
  AdminAuthService,
  DEFAULT_ADMIN_API_TRUSTED_NETWORKS,
  parseTrustedNetworks,
  TrustedNetwork,
  V1AuthController,
} from './security'
import { UrlShorteningService } from './services/UrlShorteningService'
import { VsAgentService } from './services/VsAgentService'

@Module({})
export class VsAgentModule {
  static register(
    agent: VsAgent,
    publicApiBaseUrl: string,
    nestPlugins: VsAgentNestPlugin[] = [],
    options: {
      authMode?: string
      allowedAccounts?: string[]
      trustedNetworks?: TrustedNetwork[]
      bootstrapState?: BootstrapState
    } = {},
  ): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }
    const bootstrapState = options.bootstrapState ?? new BootstrapState()
    const trustedNetworks =
      options.trustedNetworks ?? parseTrustedNetworks(DEFAULT_ADMIN_API_TRUSTED_NETWORKS)

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
      V2Openid4vcController,
      V2AnoncredsController,
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

    const securityControllers = [V1AuthController]
    const securityProviders = [
      AdminAuthService,
      { provide: 'ADMIN_AUTH_MODE', useValue: options.authMode ?? 'internal' },
      { provide: 'ADMIN_TRUSTED_NETWORKS', useValue: trustedNetworks },
      { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: options.allowedAccounts ?? [] },
      { provide: APP_GUARD, useClass: AdminAuthGuard },
    ]

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
