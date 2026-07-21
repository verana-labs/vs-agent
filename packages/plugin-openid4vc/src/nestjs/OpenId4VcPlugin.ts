import type { OpenId4VcPluginOptions, OpenId4VcSigningOptions } from '../types'
import type { BaseAgent } from '@credo-ts/core'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { validateOpenId4VcOptions } from '../config'
import { setupOpenId4Vc } from '../sdk/setupOpenId4Vc'
import { loadSigningCertificate } from '../services/CertificateService'
import { IssuerService, type OpenId4VcIssuerAgent } from '../services/IssuerService'

import { IssuerController } from './IssuerController'

type OpenId4VcLifecycleAgent = Pick<BaseAgent, 'dids' | 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  publicApiBaseUrl?: string
  modules: OpenId4VcIssuerAgent['modules']
}

class VerifierService {
  private initialization?: Promise<void>

  public constructor(
    private readonly agent: OpenId4VcLifecycleAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

  public ensureInitialized(): Promise<void> {
    this.initialization ??= initializeSigningCertificate(
      this.agent,
      this.options.verifier!.signing,
      this.options.publicApiBaseUrl,
    )
    return this.initialization
  }
}

class VerifierController {}

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
      await Promise.all([
        ...(options.issuer ? [getIssuerService(lifecycleAgent).ensureInitialized()] : []),
        ...(options.verifier ? [getVerifierService(lifecycleAgent).ensureInitialized()] : []),
      ])
    },
  }
}

async function initializeSigningCertificate(
  agent: OpenId4VcLifecycleAgent,
  signing: OpenId4VcSigningOptions,
  publicApiBaseUrl: string,
): Promise<void> {
  await loadSigningCertificate(agent, signing, publicApiBaseUrl)
}
