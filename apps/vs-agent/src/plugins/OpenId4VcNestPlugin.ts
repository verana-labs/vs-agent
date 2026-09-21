import type {
  OpenId4VcIssuerAgent,
  OpenId4VcPluginOptions,
  OpenId4VcVerifierAgent,
} from '@verana-labs/vs-agent-plugin-openid4vc'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  IssuerService,
  setupOpenId4Vc,
  validateOpenId4VcOptions,
  VerifierService,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { V2Openid4vcCredentialExchangesController } from '../controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'

type OpenId4VcAgent = OpenId4VcIssuerAgent & OpenId4VcVerifierAgent

export function OpenId4VcNestPlugin(options: OpenId4VcPluginOptions): VsAgentNestPlugin {
  validateOpenId4VcOptions(options)

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
      ...(options.issuer ? [{ provide: IssuerService, useFactory: issuerFor, inject: ['VSAGENT'] }] : []),
      ...(options.verifier
        ? [{ provide: VerifierService, useFactory: verifierFor, inject: ['VSAGENT'] }]
        : []),
    ],
    initialize: async agent => {
      const openId4VcAgent = agent as unknown as OpenId4VcAgent
      if (options.issuer) await issuerFor(openId4VcAgent).ensureInitialized()
      if (options.verifier) await verifierFor(openId4VcAgent).ensureInitialized()
    },
  }
}
