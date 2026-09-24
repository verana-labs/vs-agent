import type { OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import {
  IssuerService,
  OPENID4VC_OPTIONS,
  requireIssuerService,
  setupOpenId4Vc,
  VerifierService,
} from '@verana-labs/vs-agent-plugin-openid4vc'

import { V2Openid4vcCredentialExchangesController } from '../controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'

export function OpenId4VcNestPlugin(options: OpenId4VcPluginOptions): VsAgentNestPlugin {
  const sdkPlugin = setupOpenId4Vc(options, requireIssuerService)

  return {
    name: 'openid4vc',
    credoPlugin: sdkPlugin,
    publicMiddleware: sdkPlugin.publicMiddleware,
    controllers: [
      V2Openid4vcCredentialExchangesController,
      V2Openid4vcPresentationsController,
      V2Openid4vcSigningCertificatesController,
    ],
    providers: [{ provide: OPENID4VC_OPTIONS, useValue: options }, IssuerService, VerifierService],
  }
}
