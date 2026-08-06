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
import {
  findBoundVerificationMethodId,
  ownDidResolutionPolicy,
  verifyKeyBoundToDid,
} from '../trust/keyBinding'

import {
  didFromValidatedCertificate,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  signingCertificateInfo,
  type SigningCertificateHandle,
  type SigningCertificateInfo,
} from './CertificateService'
import { StatusListService } from './StatusListService'

type IssuerApi = Pick<
  OpenId4VcIssuerApi,
  | 'getIssuerByIssuerId'
  | 'createIssuer'
  | 'updateIssuerMetadata'
  | 'createCredentialOffer'
  | 'getIssuanceSessionById'
>

export type OpenId4VcIssuerAgent = Pick<
  BaseAgent,
  'dids' | 'genericRecords' | 'kms' | 'x509' | 'dependencyManager'
> & {
  did?: string
  modules: {
    openId4Vc?: {
      issuer?: IssuerApi
    }
  }
}

export type VtSdJwtVcTypeMetadata = SdJwtVcTypeMetadata & {
  relatedJsonSchemaCredentialId: string
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
  private statusListService?: StatusListService
  private initialized = false

  public constructor(
    private readonly agent: OpenId4VcIssuerAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

  public ensureInitialized(): Promise<void> {
    // A rejected initialization must not be cached: a transient boot-time
    // failure (KMS or storage not ready yet) would otherwise wedge the
    // process until restart. Reset so the next call retries.
    this.initialization ??= this.initialize().catch(error => {
      this.initialization = undefined
      throw error
    })
    return this.initialization
  }

  public async createOffer(
    credentialConfigurationId: string,
    inputClaims: unknown,
  ): Promise<OpenId4VcOfferResult> {
    await this.ensureInitialized()
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
    await this.ensureInitialized()

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

  /** Public signing-certificate material, for operators wiring verifier
   *  fingerprint pins (never includes private keys). */
  public getCertificateInfo(): SigningCertificateInfo {
    this.assertInitialized()
    return signingCertificateInfo('issuer', this.signingCertificateHandle())
  }

  /** SD-JWT VC issuer metadata. Credentials are signed with `x5c`, so a holder that
   *  anchors the issuer on its origin rather than on the DID needs the signing key
   *  published here to accept them at all. */
  public getJwtVcIssuerMetadata(): Record<string, unknown> {
    this.assertInitialized()
    return {
      issuer: this.options.publicApiBaseUrl,
      jwks: { keys: [this.signingCertificateHandle().certificate.publicJwk.toJson()] },
    }
  }

  /** SD-JWT VC type metadata, extended with the Verifiable Trust link: the
   *  ecosystem's VTJSC (relatedJsonSchemaCredentialId) is THE schema anchor -
   *  wallets verify the VTJSC signature and resolve the schema through their
   *  own VPR access from its $ref + digestSRI. The spec's additional-property
   *  extensibility keeps plain SD-JWT VC consumers unaffected. */
  public getVctMetadata(configurationId: string): VtSdJwtVcTypeMetadata | undefined {
    const configuration = findCredentialConfiguration(this.options, configurationId)
    if (!configuration) return undefined

    return {
      vct: configuration.vct,
      relatedJsonSchemaCredentialId: configuration.vtjscId,
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
    const status = await this.statusListService?.allocate(input.issuanceSession.id)
    const payload = {
      ...claims,
      vct: configuration.vct,
      iat: issuedAt,
      exp: issuedAt + configuration.ttlSeconds,
      ...(status ?? {}),
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
    await publishDevelopmentSigningKey(
      this.agent,
      signingCertificate,
      'issuer',
      this.issuerOptions().metadataSigner === 'did' ? ['authentication'] : [],
    )

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

    await this.createOrUpdateIssuer(signingCertificate)

    if (this.options.revocation?.enabled) {
      this.statusListService = new StatusListService(
        this.agent,
        signingCertificate,
        this.options.publicApiBaseUrl,
        this.options.revocation.size,
      )
      await this.statusListService.initialize()
    }

    this.signingCertificate = signingCertificate
    this.initialized = true
  }

  /** The signed status list token for `listId`, served at `<publicApiBaseUrl>/oid4vc/status-list/:id`. */
  public getStatusListToken(listId: string): string | undefined {
    return this.statusListService?.getToken(listId)
  }

  /** Revoke every credential issued for `issuanceSessionId`. Idempotent. */
  public revokeIssuanceSession(issuanceSessionId: string): Promise<number[]> {
    if (!this.statusListService) throw new OpenId4VcIssuerRequestError('revocation is not enabled')
    return this.statusListService.revoke(issuanceSessionId)
  }

  private async buildMetadataSigner(signingCertificate: SigningCertificateHandle) {
    if (this.issuerOptions().metadataSigner === 'did') {
      const did = this.agent.did ?? null
      const didUrl = await findBoundVerificationMethodId(
        this.agent,
        did,
        signingCertificate.certificate.publicJwk.toJson(),
        ['authentication'],
        ownDidResolutionPolicy(did ?? ''),
      )
      if (!didUrl) {
        throw new Error(
          'OpenID4VC issuer is configured to sign metadata with its DID, but the DID does not publish the signing key for authentication',
        )
      }
      return { method: 'did' as const, didUrl }
    }

    return {
      method: 'x5c' as const,
      x5c: signingCertificate.development
        ? signingCertificate.chain
        : signingCertificate.chain.filter(
            (certificate, index, chain) =>
              index !== chain.length - 1 || certificate.subject !== certificate.issuer,
          ),
    }
  }

  private async createOrUpdateIssuer(signingCertificate: SigningCertificateHandle): Promise<void> {
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
      await this.issuerApi().createIssuer({
        ...metadata,
        metadataSigner: await this.buildMetadataSigner(signingCertificate),
      })
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
          // `attestation` is advertised only where a key-attestation trust anchor is configured,
          // since accepting that proof means verifying it. Wallets that sign their own proof keep
          // using `jwt` and are untouched - `key_attestations_required` is deliberately absent
          // here, because on the record it makes a Credo holder refuse plain JWK binding.
          proof_types_supported: {
            jwt: { proof_signing_alg_values_supported: ['ES256'] },
            ...(this.issuerOptions().keyAttestationCertificates?.length
              ? { attestation: { proof_signing_alg_values_supported: ['ES256'] } }
              : {}),
          },
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
