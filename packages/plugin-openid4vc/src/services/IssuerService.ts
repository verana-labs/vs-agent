import type { OpenId4VcOfferIssuanceMetadata, OpenId4VcPluginOptions } from '../types'
import type { BaseAgent, JwsProtectedHeaderOptions, Kms, SdJwtVcTypeMetadata } from '@credo-ts/core'
import type {
  OpenId4VcIssuanceSessionRecord,
  OpenId4VcIssuanceSessionState,
  OpenId4VcIssuerApi,
  OpenId4VciCredentialConfigurationsSupportedWithFormats,
  OpenId4VciCredentialRequestToCredentialMapper,
} from '@credo-ts/openid4vc'

import { AgentContext, ClaimFormat, JwsService, RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'

import {
  findCredentialConfiguration,
  ISSUER_CAPABILITY_ID,
  parseOfferClaims,
  parseOfferIssuanceMetadata,
  parseOfferTtlSeconds,
} from '../config'
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
  x5cCertificateChain,
} from './CertificateService'

type IssuerApi = Pick<
  OpenId4VcIssuerApi,
  | 'getIssuerByIssuerId'
  | 'createIssuer'
  | 'updateIssuerMetadata'
  | 'createCredentialOffer'
  | 'getIssuanceSessionById'
  | 'deleteIssuanceSessionById'
  | 'getIssuerMetadata'
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

export type VtSdJwtVcTypeMetadata = Omit<SdJwtVcTypeMetadata, 'display'> & {
  relatedJsonSchemaCredentialId: string
  display?: (NonNullable<SdJwtVcTypeMetadata['display']>[number] & { lang?: string })[]
}

export interface OpenId4VcCreateOfferOptions {
  credentialConfigurationId: string
  claims: unknown
  ttlSeconds: unknown
}

export interface OpenId4VcOfferResult {
  credentialOffer: string
  issuanceSessionId: string
}

export interface OpenId4VcIssuanceSessionSummary {
  id: string
  credentialConfigurationId: string
  state: OpenId4VcIssuanceSessionState
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  errorMessage?: string
}

export class OpenId4VcIssuerRequestError extends Error {}
export class UnknownCredentialConfigurationError extends Error {}
export class UnknownIssuanceSessionError extends Error {}

export class IssuerService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private signedMetadataJwt?: string
  private initialized = false

  public constructor(
    private readonly agent: OpenId4VcIssuerAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

  public ensureInitialized(): Promise<void> {
    // A rejected initialization is not cached, so a transient boot-time failure retries instead of wedging the process until restart.
    this.initialization ??= this.initialize().catch(error => {
      this.initialization = undefined
      throw error
    })
    return this.initialization
  }

  public async createOffer({
    credentialConfigurationId,
    claims,
    ttlSeconds,
  }: OpenId4VcCreateOfferOptions): Promise<OpenId4VcOfferResult> {
    await this.ensureInitialized()
    const configuration = findCredentialConfiguration(this.options, credentialConfigurationId)
    if (!configuration) {
      throw new UnknownCredentialConfigurationError(
        `unknown credential configuration '${credentialConfigurationId}'`,
      )
    }

    let issuanceMetadata: OpenId4VcOfferIssuanceMetadata
    try {
      issuanceMetadata = {
        claims: parseOfferClaims(configuration, claims),
        ttlSeconds: parseOfferTtlSeconds(ttlSeconds),
      }
    } catch (error) {
      throw new OpenId4VcIssuerRequestError(
        error instanceof Error ? error.message : 'invalid credential offer',
      )
    }

    const { credentialOffer, issuanceSession } = await this.issuerApi().createCredentialOffer({
      issuerId: ISSUER_CAPABILITY_ID,
      credentialConfigurationIds: [configuration.id],
      preAuthorizedCodeFlowConfig: {},
      issuanceMetadata,
    })

    return { credentialOffer, issuanceSessionId: issuanceSession.id }
  }

  public async getIssuanceSession(id: string): Promise<OpenId4VcIssuanceSessionSummary> {
    await this.ensureInitialized()
    return summarizeIssuanceSession(await this.findOwnedSession(id))
  }

  public async listIssuanceSessions(): Promise<OpenId4VcIssuanceSessionSummary[]> {
    await this.ensureInitialized()
    const repository = this.agent.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
    const agentContext = this.agent.dependencyManager.resolve(AgentContext)
    const sessions = await repository.findByQuery(agentContext, { issuerId: ISSUER_CAPABILITY_ID })
    return sessions.map(summarizeIssuanceSession)
  }

  public async deleteIssuanceSession(id: string): Promise<void> {
    await this.ensureInitialized()
    await this.findOwnedSession(id)
    await this.issuerApi().deleteIssuanceSessionById(id)
  }

  private async findOwnedSession(id: string): Promise<OpenId4VcIssuanceSessionRecord> {
    let session: OpenId4VcIssuanceSessionRecord
    try {
      session = await this.issuerApi().getIssuanceSessionById(id)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw new UnknownIssuanceSessionError(`unknown issuance session '${id}'`)
      }
      throw error
    }
    if (session.issuerId !== ISSUER_CAPABILITY_ID) {
      throw new UnknownIssuanceSessionError(`unknown issuance session '${id}'`)
    }
    return session
  }

  public getCertificateInfo(): SigningCertificateInfo {
    this.assertInitialized()
    return signingCertificateInfo('issuer', this.signingCertificateHandle())
  }

  public getJwtVcIssuerMetadata(): Record<string, unknown> {
    this.assertInitialized()
    return {
      issuer: this.options.publicApiBaseUrl,
      jwks: { keys: [this.signingCertificateHandle().certificate.publicJwk.toJson()] },
    }
  }

  public getSignedMetadataJwt(): string | undefined {
    return this.signedMetadataJwt
  }

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
          // swiyu predates the sd-jwt-vc rename of `lang` to `locale` and rejects the document when `lang` is absent.
          lang: 'en',
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

    const { claims, ttlSeconds } = parseOfferIssuanceMetadata(
      configuration,
      input.issuanceSession.issuanceMetadata,
    )
    const issuedAt = Math.floor(Date.now() / 1_000)
    const payload = {
      ...claims,
      vct: configuration.vct,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
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
          x5c: x5cCertificateChain(signingCertificate),
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
    this.signedMetadataJwt = await this.buildCertificateBoundSignedMetadata(signingCertificate)

    this.signingCertificate = signingCertificate
    this.initialized = true
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

    return { method: 'x5c' as const, x5c: x5cCertificateChain(signingCertificate) }
  }

  private async buildCertificateBoundSignedMetadata(
    signingCertificate: SigningCertificateHandle,
  ): Promise<string | undefined> {
    const { signedMetadataJwt } = await this.issuerApi().getIssuerMetadata(ISSUER_CAPABILITY_ID)
    if (!signedMetadataJwt) return undefined

    const [encodedHeader, encodedPayload] = signedMetadataJwt.split('.')
    const agentContext = this.agent.dependencyManager.resolve(AgentContext)

    return await this.agent.dependencyManager.resolve(JwsService).createJwsCompact(agentContext, {
      payload: Buffer.from(encodedPayload, 'base64url'),
      keyId: signingCertificate.keyId,
      protectedHeaderOptions: {
        ...parseProtectedHeader(encodedHeader),
        x5c: x5cCertificateChain(signingCertificate).map(certificate => certificate.toString('base64')),
      },
    })
  }

  private async createOrUpdateIssuer(signingCertificate: SigningCertificateHandle): Promise<void> {
    const issuer = this.issuerOptions()
    const metadata = {
      issuerId: ISSUER_CAPABILITY_ID,
      display: [{ name: issuer.displayName, locale: 'en' }],
      credentialConfigurationsSupported: this.credentialConfigurationsSupported(),
    }

    try {
      await this.issuerApi().getIssuerByIssuerId(ISSUER_CAPABILITY_ID)
    } catch (error) {
      if (!(error instanceof RecordNotFoundError)) throw error
      await this.issuerApi().createIssuer({
        ...metadata,
        metadataSigner: await this.buildMetadataSigner(signingCertificate),
      })
      return
    }

    await this.issuerApi().updateIssuerMetadata({
      ...metadata,
      metadataSigner: await this.buildMetadataSigner(signingCertificate),
    })
  }

  private credentialConfigurationsSupported(): OpenId4VciCredentialConfigurationsSupportedWithFormats {
    return Object.fromEntries(
      this.options.credentialConfigurations.map(configuration => [
        configuration.id,
        {
          format: 'dc+sd-jwt' as const,
          vct: configuration.vct,
          // `scope` is optional per OID4VCI, but wwWallet's metadata schema requires it and fails resolution without one.
          scope: configuration.id,
          cryptographic_binding_methods_supported: ['jwk'],
          credential_signing_alg_values_supported: ['ES256'],
          // Only `jwt` is advertised here: swiyu models `proof_types_supported` as a closed `ProofType` enum and throws on any other member.
          proof_types_supported: {
            jwt: { proof_signing_alg_values_supported: ['ES256'] },
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

function summarizeIssuanceSession(session: OpenId4VcIssuanceSessionRecord): OpenId4VcIssuanceSessionSummary {
  return {
    id: session.id,
    credentialConfigurationId: session.credentialOfferPayload.credential_configuration_ids?.[0] ?? '',
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt ?? session.createdAt,
    ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
    ...(session.errorMessage ? { errorMessage: session.errorMessage } : {}),
  }
}

function parseProtectedHeader(encoded: string): JwsProtectedHeaderOptions {
  let header: unknown
  try {
    header = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('signed issuer metadata carries an unreadable protected header')
  }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('signed issuer metadata carries an unreadable protected header')
  }

  const { alg } = header as { alg?: unknown }
  if (typeof alg !== 'string') {
    throw new Error('signed issuer metadata carries no signature algorithm')
  }

  return { ...(header as Record<string, unknown>), alg: alg as Kms.KnownJwaSignatureAlgorithm }
}
