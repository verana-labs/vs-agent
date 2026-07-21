import type { OpenId4VcPluginOptions } from '../types'
import type { BaseAgent } from '@credo-ts/core'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { validateOpenId4VcOptions } from '../config'
import { setupOpenId4Vc } from '../sdk/setupOpenId4Vc'
import { IssuerService, type OpenId4VcIssuerAgent } from '../services/IssuerService'
import { VerifierService, type OpenId4VcVerifierAgent } from '../services/VerifierService'

import { IssuerController } from './IssuerController'
import { VerifierController } from './VerifierController'

type OpenId4VcLifecycleAgent = Pick<BaseAgent, 'dids' | 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  publicApiBaseUrl?: string
  modules: OpenId4VcIssuerAgent['modules'] & OpenId4VcVerifierAgent['modules']
}

export function OpenId4VcPlugin(options: OpenId4VcPluginOptions): VsAgentNestPlugin {
  validateOpenId4VcOptions(options)

  let issuerService: IssuerService | undefined
  let verifierService: VerifierService | undefined

  const getIssuerService = (agent?: OpenId4VcLifecycleAgent): IssuerService => {
    if (!issuerService) {
      if (!agent) throw new Error('OpenID4VC issuer service is not initialized')
      issuerService = new IssuerService(agent, options)
    }
    return issuerService
  }
  const getVerifierService = (agent: OpenId4VcLifecycleAgent): VerifierService =>
    (verifierService ??= new VerifierService(agent, options))

  const sdkPlugin = setupOpenId4Vc(options, () => getIssuerService())

  return {
    name: 'openid4vc',
    credoPlugin: sdkPlugin,
    publicMiddleware: sdkPlugin.publicMiddleware,
    controllers: [
      ...(options.issuer ? [IssuerController] : []),
      ...(options.verifier ? [VerifierController] : []),
    ],
    providers: [
      ...(options.issuer
        ? [
            {
              provide: IssuerService,
              useFactory: (agent: OpenId4VcLifecycleAgent) => getIssuerService(agent),
              inject: ['VSAGENT'],
            },
          ]
        : []),
      ...(options.verifier
        ? [
            {
              provide: VerifierService,
              useFactory: (agent: OpenId4VcLifecycleAgent) => getVerifierService(agent),
              inject: ['VSAGENT'],
            },
          ]
        : []),
    ],
    initialize: async agent => {
      const lifecycleAgent = agent as unknown as OpenId4VcLifecycleAgent
      if (options.issuer) await getIssuerService(lifecycleAgent).ensureInitialized()
      if (options.verifier) await getVerifierService(lifecycleAgent).ensureInitialized()
    },
  }
}
