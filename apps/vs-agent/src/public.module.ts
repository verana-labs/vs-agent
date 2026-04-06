import { DynamicModule, Module } from '@nestjs/common'
import { VsAgent } from '@verana-labs/vs-agent-sdk'

import {
  CredentialTypesService,
  DidWebController,
  InvitationRoutesController,
  SelfTrController,
  TrustService,
} from './controllers'
import { UrlShorteningService } from './services'
import { VsAgentService } from './services/VsAgentService'

@Module({})
export class PublicModule {
  static register(agent: VsAgent, publicApiBaseUrl: string): DynamicModule {
    const agentRef = { get: () => agent, toJSON: () => 'VsAgent' }
    return {
      module: PublicModule,
      imports: [],
      controllers: [InvitationRoutesController, SelfTrController, DidWebController],
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
        TrustService,
        UrlShorteningService,
        CredentialTypesService,
      ],
      exports: [],
    }
  }
}
