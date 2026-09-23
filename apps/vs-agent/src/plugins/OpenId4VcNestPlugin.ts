import type { OpenId4VcAgent, OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { IssuerService, setupOpenId4Vc, VerifierService } from '@verana-labs/vs-agent-plugin-openid4vc'

import { V2Openid4vcCredentialExchangesController } from '../controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'

export function OpenId4VcNestPlugin(options: OpenId4VcPluginOptions): VsAgentNestPlugin {
  let issuerService: IssuerService | undefined
  let verifierService: VerifierService | undefined
  const issuerFor = (agent: OpenId4VcAgent): IssuerService =>
    (issuerService ??= new IssuerService(agent, options))
  const verifierFor = (agent: OpenId4VcAgent): VerifierService =>
    (verifierService ??= new VerifierService(agent, options))

  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })

  return {
    name: 'openid4vc',
    credoPlugin: sdkPlugin,
    publicMiddleware: sdkPlugin.publicMiddleware,
    controllers: [
      V2Openid4vcCredentialExchangesController,
      V2Openid4vcPresentationsController,
      V2Openid4vcSigningCertificatesController,
    ],
    providers: [
      { provide: IssuerService, useFactory: issuerFor, inject: ['VSAGENT'] },
      { provide: VerifierService, useFactory: verifierFor, inject: ['VSAGENT'] },
    ],
    initialize: async agent => {
      const openId4VcAgent = agent as OpenId4VcAgent
      await issuerFor(openId4VcAgent).ensureInitialized()
      await verifierFor(openId4VcAgent).ensureInitialized()
    },
  }
}
