import type { OpenId4VcPluginOptions, OpenId4VcSigningOptions } from '../types'
import type { BaseAgent, BaseLogger } from '@credo-ts/core'
import type { OpenId4VciCredentialRequestToCredentialMapper } from '@credo-ts/openid4vc'
import type { RequestHandler } from 'express'

import { validateOpenId4VcOptions } from '../config'
import { setupOpenId4Vc } from '../sdk/setupOpenId4Vc'
import { loadSigningCertificate } from '../services/CertificateService'

type OpenId4VcLifecycleAgent = Pick<BaseAgent, 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  publicApiBaseUrl?: string
}

interface OpenId4VcNestPlugin {
  name: string
  credoPlugin: ReturnType<typeof setupOpenId4Vc>
  initialize: (agent: OpenId4VcLifecycleAgent, logger: BaseLogger) => Promise<void>
  publicMiddleware: RequestHandler
  controllers: Array<new () => object>
  providers: unknown[]
}

class IssuerService {
  private initialization?: Promise<void>

  public constructor(
    private readonly agent: OpenId4VcLifecycleAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

  public ensureInitialized(): Promise<void> {
    this.initialization ??= initializeSigningCertificate(
      this.agent,
      this.options.issuer!.signing,
      this.options.publicApiBaseUrl,
    )
    return this.initialization
  }

  public mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper = () => {
    throw new Error('OpenID4VC issuer credential mapping is not implemented')
  }
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

class IssuerController {}
class VctController {}
class VerifierController {}

export function OpenId4VcPlugin(options: OpenId4VcPluginOptions): OpenId4VcNestPlugin {
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
      ...(options.issuer ? [IssuerController, VctController] : []),
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
      await Promise.all([
        ...(options.issuer ? [getIssuerService(agent).ensureInitialized()] : []),
        ...(options.verifier ? [getVerifierService(agent).ensureInitialized()] : []),
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
