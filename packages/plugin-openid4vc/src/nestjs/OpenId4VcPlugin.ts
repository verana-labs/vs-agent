import type { OpenId4VcIssuerSink, OpenId4VcPluginOptions } from '../types'
import type { OpenId4VcIssuerRequestMapper } from '../sdk/setupOpenId4Vc'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { IssuerService } from '../services/IssuerService'
import { VerifierService } from '../services/VerifierService'
import { OPENID4VC_ISSUER_SINK, OPENID4VC_OPTIONS } from '../types'

import { setupOpenId4Vc } from '../sdk/setupOpenId4Vc'

import { V2Openid4vcCredentialExchangesController } from './V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from './V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from './V2Openid4vcSigningCertificatesController'

export function OpenId4VcPlugin(options: OpenId4VcPluginOptions): VsAgentNestPlugin {
  let issuerService: OpenId4VcIssuerRequestMapper | undefined
  const sdkPlugin = setupOpenId4Vc(options, () => {
    if (!issuerService) throw new Error('OpenID4VC issuer service is not initialized')
    return issuerService
  })
  const publishIssuerService: OpenId4VcIssuerSink = service => {
    issuerService = service
  }

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
      { provide: OPENID4VC_OPTIONS, useValue: options },
      { provide: OPENID4VC_ISSUER_SINK, useValue: publishIssuerService },
      IssuerService,
      VerifierService,
    ],
  }
}
