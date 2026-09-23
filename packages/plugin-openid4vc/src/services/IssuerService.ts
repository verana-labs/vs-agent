import type { OpenId4VcAgent, OpenId4VcPluginOptions } from '../types'
import type { JwsProtectedHeaderOptions, Kms } from '@credo-ts/core'
import type {
  OpenId4VcIssuanceSessionRecord,
  OpenId4VcIssuanceSessionState,
  OpenId4VcIssuerApi,
  OpenId4VciCredentialConfigurationsSupportedWithFormats,
  OpenId4VciCredentialRequestToCredentialMapper,
} from '@credo-ts/openid4vc'

import { ClaimFormat, JwsService, RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'

import {
  findCredentialConfiguration,
  ISSUER_CAPABILITY_ID,
  parseOfferClaims,
  parseOfferIssuanceMetadata,
  parseOfferTtlSeconds,
} from '../config'
import { OpenId4VcError, OpenId4VcErrorCode } from '../errors'
import { ownDidResolutionPolicy, verifyKeyBoundToDid } from '../trust/keyBinding'
import { serviceDisplay } from '../utils/serviceDisplay'

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

export interface OpenId4VcCreateOfferOptions {
  jsonSchemaCredentialId: string
  claims: unknown
  ttlSeconds: unknown
  statusListId?: string
  statusListIndex?: number
}

export interface OpenId4VcOfferResult {
  credentialOffer: string
  issuanceSessionId: string
}

export interface OpenId4VcIssuanceSessionSummary {
  id: string
  jsonSchemaCredentialId: string
  statusListId?: string
  statusListIndex?: number
  state: OpenId4VcIssuanceSessionState
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  errorMessage?: string
}

export class IssuerService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private signedMetadataJwt?: string
  private initialized = false

  public constructor(
    private readonly agent: OpenId4VcAgent,
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
    jsonSchemaCredentialId,
    claims,
    ttlSeconds,
    statusListId,
    statusListIndex,
  }: OpenId4VcCreateOfferOptions): Promise<OpenId4VcOfferResult> {
    await this.ensureInitialized()
    const configuration = findCredentialConfiguration(this.options, jsonSchemaCredentialId)
    if (!configuration) {
      throw new OpenId4VcError(
        OpenId4VcErrorCode.UnknownCredentialType,
        `no credential type with id "${jsonSchemaCredentialId}"`,
      )
    }

    if ((statusListId === undefined) !== (statusListIndex === undefined)) {
      throw new OpenId4VcError(
        OpenId4VcErrorCode.InvalidCredentialOffer,
        'statusListId and statusListIndex must be both present or both absent',
      )
    }
    if (statusListId !== undefined) {
      throw new OpenId4VcError(
        OpenId4VcErrorCode.UnknownStatusList,
        `no status list with id "${statusListId}"`,
      )
    }

    let issuanceMetadata: { claims: Record<string, unknown>; ttlSeconds: number }
    try {
      issuanceMetadata = {
        claims: parseOfferClaims(configuration, claims),
        ttlSeconds: parseOfferTtlSeconds(ttlSeconds),
      }
    } catch (error) {
      throw new OpenId4VcError(
        OpenId4VcErrorCode.InvalidCredentialOffer,
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
    const agentContext = this.agent.context
    const repository = agentContext.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
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
        throw new OpenId4VcError(
          OpenId4VcErrorCode.UnknownIssuanceSession,
          `no issuance session with id "${id}"`,
        )
      }
      throw error
    }
    if (session.issuerId !== ISSUER_CAPABILITY_ID) {
      throw new OpenId4VcError(
        OpenId4VcErrorCode.UnknownIssuanceSession,
        `no issuance session with id "${id}"`,
      )
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
      this.options.issuer?.signing,
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

    await this.createOrUpdateIssuer(signingCertificate)
    this.signedMetadataJwt = await this.buildCertificateBoundSignedMetadata(signingCertificate)

    this.signingCertificate = signingCertificate
    this.initialized = true
  }

  private metadataSigner(signingCertificate: SigningCertificateHandle) {
    return { method: 'x5c' as const, x5c: x5cCertificateChain(signingCertificate) }
  }

  private async buildCertificateBoundSignedMetadata(
    signingCertificate: SigningCertificateHandle,
  ): Promise<string | undefined> {
    const { signedMetadataJwt } = await this.issuerApi().getIssuerMetadata(ISSUER_CAPABILITY_ID)
    if (!signedMetadataJwt) return undefined

    const [encodedHeader, encodedPayload] = signedMetadataJwt.split('.')
    const agentContext = this.agent.context

    return await agentContext.dependencyManager.resolve(JwsService).createJwsCompact(agentContext, {
      payload: Buffer.from(encodedPayload, 'base64url'),
      keyId: signingCertificate.keyId,
      protectedHeaderOptions: {
        ...parseProtectedHeader(encodedHeader),
        x5c: x5cCertificateChain(signingCertificate).map(certificate => certificate.toString('base64')),
      },
    })
  }

  private async createOrUpdateIssuer(signingCertificate: SigningCertificateHandle): Promise<void> {
    const display = serviceDisplay(this.agent)
    const metadata = {
      issuerId: ISSUER_CAPABILITY_ID,
      ...(display
        ? {
            display: [
              {
                name: display.name,
                locale: 'en',
                ...(display.logoUri ? { logo: { uri: display.logoUri } } : {}),
              },
            ],
          }
        : {}),
      credentialConfigurationsSupported: this.credentialConfigurationsSupported(),
      metadataSigner: this.metadataSigner(signingCertificate),
    }

    try {
      await this.issuerApi().getIssuerByIssuerId(ISSUER_CAPABILITY_ID)
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
    jsonSchemaCredentialId: session.credentialOfferPayload.credential_configuration_ids?.[0] ?? '',
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
