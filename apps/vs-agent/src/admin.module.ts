import { DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { VsAgent, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  ServiceEndpointsService,
  V2AgentController,
  V2AnoncredsController,
  V2AnoncredsCredentialDefinitionsController,
  V2AnoncredsRevocationRegistriesController,
  V2AuthController,
  V2DidcommBasicMessagesController,
  V2DidcommConnectionsController,
  V2DidcommController,
  V2DidcommCredentialExchangesController,
  V2DidcommInvitationsController,
  V2DidcommPresentationsController,
  V2VtServiceEndpointsController,
  InvitationsService,
} from './controllers'
import { BOOTSTRAP_STATE, BootstrapState } from './common'
import {
  AdminAuthGuard,
  AdminAuthService,
  DEFAULT_ADMIN_API_TRUSTED_NETWORKS,
  parseTrustedNetworks,
  TrustedNetwork,
} from './security'
import { CredentialTypesService } from './services/CredentialTypesService'
import { UrlShorteningService } from './services/UrlShorteningService'
import { VsAgentService } from './services/VsAgentService'
import { DIDCOMM_MODULES } from './utils/didcommModules'
import { nestPluginContributions } from './utils/pluginLifecycle'

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
    const pluginParts = nestPluginContributions(nestPlugins)
    const bootstrapState = options.bootstrapState ?? new BootstrapState()
    const trustedNetworks =
      options.trustedNetworks ?? parseTrustedNetworks(DEFAULT_ADMIN_API_TRUSTED_NETWORKS)

    const v2Controllers = [
      V2AuthController,
      V2AgentController,
      V2DidcommController,
      V2DidcommBasicMessagesController,
      V2DidcommPresentationsController,
      V2DidcommConnectionsController,
      V2DidcommCredentialExchangesController,
      V2DidcommInvitationsController,
      V2AnoncredsController,
      V2AnoncredsCredentialDefinitionsController,
      V2AnoncredsRevocationRegistriesController,
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
      {
        provide: 'DIDCOMM_MODULES',
        useValue: [...DIDCOMM_MODULES, ...pluginParts.didcommModules],
      },
      VsAgentService,
      UrlShorteningService,
      CredentialTypesService,
      ServiceEndpointsService,
      InvitationsService,
    ]

    const securityProviders = [
      AdminAuthService,
      { provide: 'ADMIN_AUTH_MODE', useValue: options.authMode ?? 'internal' },
      { provide: 'ADMIN_TRUSTED_NETWORKS', useValue: trustedNetworks },
      { provide: 'ADMIN_ALLOWED_ACCOUNTS', useValue: options.allowedAccounts ?? [] },
      { provide: APP_GUARD, useClass: AdminAuthGuard },
    ]

    return {
      module: VsAgentModule,
      imports: pluginParts.imports,
      controllers: [...v2Controllers, ...pluginParts.controllers],
      providers: [...baseProviders, ...securityProviders, ...pluginParts.providers],
      exports: [VsAgentService],
    }
  }
}
