import type { OpenId4VcPluginOptions } from '../types'
import type { BaseAgent, SdJwtVcTypeMetadata } from '@credo-ts/core'
import type {
  OpenId4VcIssuanceSessionRecord,
  OpenId4VcIssuerApi,
  OpenId4VciCredentialConfigurationsSupportedWithFormats,
  OpenId4VciCredentialRequestToCredentialMapper,
} from '@credo-ts/openid4vc'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'

import { findCredentialConfiguration, parseOfferClaims } from '../config'
import { ownDidResolutionPolicy, verifyKeyBoundToDid } from '../trust/keyBinding'

import {
  didFromValidatedCertificate,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  type SigningCertificateHandle,
} from './CertificateService'

type IssuerApi = Pick<
  OpenId4VcIssuerApi,
  | 'getIssuerByIssuerId'
  | 'createIssuer'
  | 'updateIssuerMetadata'
  | 'createCredentialOffer'
  | 'getIssuanceSessionById'
>

export type OpenId4VcIssuerAgent = Pick<BaseAgent, 'dids' | 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  modules: {
    openId4Vc?: {
      issuer?: IssuerApi
    }
  }
}

export interface OpenId4VcOfferResult {
  credentialOffer: string
  issuanceSessionId: string
}

export interface OpenId4VcOfferState {
  id: string
  state: OpenId4VcIssuanceSessionRecord['state']
  createdAt: Date
  expiresAt?: Date
}

export class OpenId4VcIssuerRequestError extends Error {}
export class OpenId4VcOfferNotFoundError extends Error {}

export class IssuerService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private initialized = false

  public constructor(
    private readonly agent: OpenId4VcIssuerAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

  public ensureInitialized(): Promise<void> {
    this.initialization ??= this.initialize()
    return this.initialization
  }

  public async createOffer(
    credentialConfigurationId: string,
    inputClaims: unknown,
  ): Promise<OpenId4VcOfferResult> {
    this.assertInitialized()
    const configuration = findCredentialConfiguration(this.options, credentialConfigurationId)
    if (!configuration) {
      throw new OpenId4VcIssuerRequestError(`unknown credential configuration '${credentialConfigurationId}'`)
    }

    let claims: Record<string, unknown>
    try {
      claims = parseOfferClaims(configuration, inputClaims)
    } catch (error) {
      throw new OpenId4VcIssuerRequestError(error instanceof Error ? error.message : 'invalid claims')
    }

    const { credentialOffer, issuanceSession } = await this.issuerApi().createCredentialOffer({
      issuerId: this.issuerOptions().id,
      credentialConfigurationIds: [configuration.id],
      preAuthorizedCodeFlowConfig: {},
      issuanceMetadata: claims,
    })

    return { credentialOffer, issuanceSessionId: issuanceSession.id }
  }

  public async getOfferState(id: string): Promise<OpenId4VcOfferState> {
    this.assertInitialized()

    let session: OpenId4VcIssuanceSessionRecord
    try {
      session = await this.issuerApi().getIssuanceSessionById(id)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw new OpenId4VcOfferNotFoundError(`OpenID4VC offer '${id}' was not found`)
      }
      throw error
    }

    return {
      id: session.id,
      state: session.state,
      createdAt: session.createdAt,
      ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
    }
  }

  public getVctMetadata(configurationId: string): SdJwtVcTypeMetadata | undefined {
    const configuration = findCredentialConfiguration(this.options, configurationId)
    if (!configuration) return undefined

    return {
      vct: configuration.vct,
      name: configuration.name,
      ...(configuration.description ? { description: configuration.description } : {}),
      display: [
        {
          locale: 'en',
          name: configuration.name,
          ...(configuration.description ? { description: configuration.description } : {}),
        },
      ],
      claims: configuration.claims.map(claim => ({ path: [claim] })),
    }
  }

  public mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper = async input => {
    this.assertInitialized()
    const signingCertificate = this.signingCertificateHandle()
    const configuration = findCredentialConfiguration(this.options, input.credentialConfigurationId)
    if (!configuration) {
      throw new Error(`unknown credential configuration '${input.credentialConfigurationId}'`)
    }

    const claims = parseOfferClaims(configuration, input.issuanceSession.issuanceMetadata)
    const issuedAt = Math.floor(Date.now() / 1_000)
    const payload = {
      ...claims,
      vct: configuration.vct,
      iat: issuedAt,
      exp: issuedAt + configuration.ttlSeconds,
    }

    return {
      type: 'credentials',
      format: ClaimFormat.SdJwtDc,
      credentials: input.holderBinding.keys.map(holderKey => ({
        payload,
        holder:
          holderKey.method === 'did'
            ? { method: 'did' as const, didUrl: holderKey.didUrl }
            : { method: 'jwk' as const, jwk: holderKey.jwk },
        issuer: {
          method: 'x5c' as const,
          x5c: signingCertificate.chain,
          issuer: this.options.publicApiBaseUrl,
        },
        disclosureFrame: { _sd: configuration.disclosureFrame },
        headerType: 'dc+sd-jwt' as const,
      })),
    }
  }

  private async initialize(): Promise<void> {
    const agentDid = this.agent.did
    if (!agentDid) throw new Error('OpenID4VC issuer initialization requires an agent DID')

    const signingCertificate = await loadSigningCertificate(
      this.agent,
      this.issuerOptions().signing,
      this.options.publicApiBaseUrl,
      'issuer',
    )
    const certificateDid = didFromValidatedCertificate(signingCertificate.certificate)
    if (certificateDid !== agentDid) {
      throw new Error('OpenID4VC issuer certificate DID does not match the agent DID')
    }
    await publishDevelopmentSigningKey(this.agent, signingCertificate, 'issuer')

    const binding = await verifyKeyBoundToDid(
      this.agent,
      agentDid,
      signingCertificate.certificate.publicJwk.toJson(),
      ['assertionMethod'],
      ownDidResolutionPolicy(agentDid),
    )
    if (binding === 'unresolvable') {
      throw new Error('OpenID4VC issuer DID could not be resolved for assertionMethod key binding')
    }
    if (binding !== 'bound') {
      throw new Error('OpenID4VC issuer certificate key is not bound to the agent DID assertionMethod')
    }

    await this.createOrUpdateIssuer()
    this.signingCertificate = signingCertificate
    this.initialized = true
  }

  private async createOrUpdateIssuer(): Promise<void> {
    const issuer = this.issuerOptions()
    const issuerId = issuer.id
    const metadata = {
      issuerId,
      display: [{ name: issuer.displayName, locale: 'en' }],
      credentialConfigurationsSupported: this.credentialConfigurationsSupported(),
    }

    try {
      await this.issuerApi().getIssuerByIssuerId(issuerId)
    } catch (error) {
      if (!(error instanceof RecordNotFoundError)) throw error
      await this.issuerApi().createIssuer(metadata)
      return
    }

    await this.issuerApi().updateIssuerMetadata(metadata)
  }

  private credentialConfigurationsSupported(): OpenId4VciCredentialConfigurationsSupportedWithFormats {
    return Object.fromEntries(
      this.options.credentialConfigurations.map(configuration => [
        configuration.id,
        {
          format: 'dc+sd-jwt' as const,
          vct: configuration.vct,
          cryptographic_binding_methods_supported: ['jwk'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
          credential_metadata: {
            display: [
              {
                name: configuration.name,
                ...(configuration.description ? { description: configuration.description } : {}),
                locale: 'en',
              },
            ],
            claims: configuration.claims.map(claim => ({ path: [claim] })),
          },
        },
      ]),
    )
  }

  private issuerApi(): IssuerApi {
    const issuer = this.agent.modules.openId4Vc?.issuer
    if (!issuer) throw new Error('OpenID4VC issuer API is not enabled on this agent')
    return issuer
  }

  private issuerOptions(): NonNullable<OpenId4VcPluginOptions['issuer']> {
    const issuer = this.options.issuer
    if (!issuer) throw new Error('OpenID4VC issuer capability is not configured')
    return issuer
  }

  private signingCertificateHandle(): SigningCertificateHandle {
    const signingCertificate = this.signingCertificate
    if (!signingCertificate) throw new Error('OpenID4VC issuer service is not initialized')
    return signingCertificate
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.signingCertificate) {
      throw new Error('OpenID4VC issuer service is not initialized')
    }
  }
}
