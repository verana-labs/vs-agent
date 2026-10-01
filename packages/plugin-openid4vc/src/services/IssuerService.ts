import type {
  OpenId4VcAgent,
  OpenId4VcCredentialConfiguration,
  OpenId4VcIssuerSink,
  OpenId4VcPluginOptions,
} from '../types'
import type { Kms } from '@credo-ts/core'
import type { OnModuleInit } from '@nestjs/common'
import type {
  OpenId4VcIssuanceSessionRecord,
  OpenId4VcIssuanceSessionState,
  OpenId4VcIssuerApi,
  OpenId4VciCredentialConfigurationsSupportedWithFormats,
  OpenId4VciCredentialRequestToCredentialMapper,
} from '@credo-ts/openid4vc'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { Inject, Injectable } from '@nestjs/common'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'
import {
  AdminApiError,
  AdminApiErrorCode,
  ParticipantRole,
  trustDecisionError,
} from '@verana-labs/vs-agent-sdk'

import {
  findCredentialConfiguration,
  ISSUER_CAPABILITY_ID,
  OfferClaimsError,
  parseOfferClaims,
  parseOfferIssuanceMetadata,
  parseOfferTtlSeconds,
} from '../config'
import { verifyKeyBoundToDid } from '../trust/keyBinding'
import { OPENID4VC_ISSUER_SINK, OPENID4VC_OPTIONS } from '../types'
import { serviceDisplay } from '../utils/serviceDisplay'

import { buildCredentialConfigurations, resolveCredentialType } from './credentialConfigurationBuilder'
import { createTypeMetadataIntegrity } from './typeMetadataIntegrity'

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
>

export interface OpenId4VcCreateOfferOptions {
  jsonSchemaCredentialId: string
  claims: unknown
  ttlSeconds: unknown
  statusListId?: string
  statusListIndex?: number
}

export interface OpenId4VcIssuanceSessionFilters {
  jsonSchemaCredentialId?: string
  state?: OpenId4VcIssuanceSessionState
}

export interface OpenId4VcOfferResult {
  credentialOffer: string
  issuanceSessionId: string
}

export interface OpenId4VcIssuanceSessionSummary {
  id: string
  jsonSchemaCredentialId: string
  state: OpenId4VcIssuanceSessionState
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  errorMessage?: string
}

const BAD_REQUEST = 400
const NOT_FOUND = 404
const SERVICE_UNAVAILABLE = 503

const JSON_SCHEMA_CREDENTIAL_ID_TAG = 'jsonSchemaCredentialId'
const DPOP_ALGORITHMS: [Kms.KnownJwaSignatureAlgorithm] = ['ES256']
const ATTESTATION_ALGORITHMS: [Kms.KnownJwaSignatureAlgorithm] = ['ES256']

@Injectable()
export class IssuerService implements OnModuleInit {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private replacement: Promise<void> = Promise.resolve()
  private readonly typeMetadataIntegrity = createTypeMetadataIntegrity()
  /**
   * DEMO ONLY (AGENT_UNSAFE_SKIP_OWN_AUTHORIZATION): the credential types the agent offers
   * without an ISSUER Participant, keyed by `jsonSchemaCredentialId`. Each refresh keeps them.
   */
  private readonly unaccreditedConfigurations = new Map<string, OpenId4VcCredentialConfiguration>()

  public constructor(
    @Inject('VSAGENT') private readonly agent: OpenId4VcAgent,
    @Inject(OPENID4VC_OPTIONS) private readonly options: OpenId4VcPluginOptions,
    @Inject(OPENID4VC_ISSUER_SINK) private readonly publishIssuerService: OpenId4VcIssuerSink,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.publishIssuerService(this)
    await this.ensureInitialized()
  }

  public async refreshCredentialConfigurations(updatedCredentialSchemaId?: number): Promise<void> {
    if (!this.signingCertificate) return
    const updated = this.options.credentialConfigurations.find(
      configuration => configuration.credentialSchemaId === updatedCredentialSchemaId,
    )
    if (updated) this.typeMetadataIntegrity.invalidate(updated.vct)
    await this.replaceCredentialConfigurations()
  }

  public ensureInitialized(): Promise<void> {
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
    const configuration =
      findCredentialConfiguration(this.options, jsonSchemaCredentialId) ??
      (await this.addUnaccreditedConfiguration(jsonSchemaCredentialId))
    if (!configuration) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        NOT_FOUND,
        `no credential type with id "${jsonSchemaCredentialId}"`,
      )
    }

    if ((statusListId === undefined) !== (statusListIndex === undefined)) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidInput,
        BAD_REQUEST,
        'statusListId and statusListIndex must be both present or both absent',
      )
    }
    if (statusListId !== undefined) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        NOT_FOUND,
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
      throw new AdminApiError(
        AdminApiErrorCode.InvalidInput,
        BAD_REQUEST,
        error instanceof Error ? error.message : 'invalid credential offer',
        error instanceof OfferClaimsError && error.violations ? { violations: error.violations } : undefined,
      )
    }

    try {
      await this.agent.anonCredsTrust.assertOwnAuthorization({
        role: ParticipantRole.Issuer,
        credentialSchemaId: configuration.credentialSchemaId,
      })
    } catch (error) {
      throw trustDecisionError(error, 'agent')
    }

    await this.assertTypeMetadataReadable(configuration.vct)

    const { credentialOffer, issuanceSession } = await this.issuerApi().createCredentialOffer({
      issuerId: ISSUER_CAPABILITY_ID,
      credentialConfigurationIds: [configuration.id],
      preAuthorizedCodeFlowConfig: {},
      issuanceMetadata,
    })

    issuanceSession.setTag(JSON_SCHEMA_CREDENTIAL_ID_TAG, configuration.id)
    await this.sessionRepository().update(this.agent.context, issuanceSession)

    return { credentialOffer, issuanceSessionId: issuanceSession.id }
  }

  public async getIssuanceSession(id: string): Promise<OpenId4VcIssuanceSessionSummary> {
    await this.ensureInitialized()
    return summarizeIssuanceSession(await this.findOwnedSession(id))
  }

  public async listIssuanceSessions(
    filters: OpenId4VcIssuanceSessionFilters = {},
  ): Promise<OpenId4VcIssuanceSessionSummary[]> {
    await this.ensureInitialized()
    const sessions = await this.sessionRepository().findByQuery(this.agent.context, {
      issuerId: ISSUER_CAPABILITY_ID,
      state: filters.state,
      [JSON_SCHEMA_CREDENTIAL_ID_TAG]: filters.jsonSchemaCredentialId,
    })
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
        throw new AdminApiError(
          AdminApiErrorCode.UnknownId,
          NOT_FOUND,
          `no credential exchange with id "${id}"`,
        )
      }
      throw error
    }
    if (session.issuerId !== ISSUER_CAPABILITY_ID) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        NOT_FOUND,
        `no credential exchange with id "${id}"`,
      )
    }
    return session
  }

  public async getCertificateInfo(): Promise<SigningCertificateInfo> {
    await this.ensureInitialized()
    return signingCertificateInfo('issuer', this.signingCertificateHandle())
  }

  public getJwtVcIssuerMetadata(): Record<string, unknown> {
    return {
      issuer: this.options.publicApiBaseUrl,
      jwks: { keys: [this.signingCertificateHandle().certificate.publicJwk.toJson()] },
    }
  }

  public mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper = async input => {
    const signingCertificate = this.signingCertificateHandle()
    const configuration = findCredentialConfiguration(this.options, input.credentialConfigurationId)
    if (!configuration) {
      throw new Error(`unknown credential configuration '${input.credentialConfigurationId}'`)
    }

    const { claims, ttlSeconds } = parseOfferIssuanceMetadata(
      configuration,
      input.issuanceSession.issuanceMetadata,
    )
    const integrity = await this.typeMetadataIntegrity.digest(configuration.vct)
    const issuedAt = Math.floor(Date.now() / 1_000)
    const payload = {
      ...claims,
      vct: configuration.vct,
      'vct#integrity': integrity,
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
    const publishedMethodId = await publishDevelopmentSigningKey(this.agent, signingCertificate, 'issuer')

    const binding = await verifyKeyBoundToDid(
      this.agent,
      agentDid,
      signingCertificate.certificate.publicJwk.toJson(),
      ['assertionMethod'],
    )
    if (binding === 'unresolvable') {
      throw new Error('OpenID4VC issuer DID could not be resolved for assertionMethod key binding')
    }
    if (binding !== 'bound') {
      throw new Error('OpenID4VC issuer certificate key is not bound to the agent DID assertionMethod')
    }

    this.signingCertificate = signingCertificate
    await this.restoreUnaccreditedConfigurations()
    try {
      await this.replaceCredentialConfigurations(true)
    } catch (error) {
      this.signingCertificate = undefined
      throw error
    }

    const mode = signingCertificate.development ? 'development' : 'configured'
    const publication = publishedMethodId ? `, published as ${publishedMethodId}` : ''
    this.agent.config.logger.info(`[OpenID4VC] issuer signs with a ${mode} certificate${publication}`)
  }

  private async assertTypeMetadataReadable(vct: string): Promise<void> {
    try {
      await this.typeMetadataIntegrity.digest(vct)
    } catch (error) {
      throw new AdminApiError(
        AdminApiErrorCode.ResolverUnavailable,
        SERVICE_UNAVAILABLE,
        `the Type Metadata at ${vct} could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  // A notification can trigger a refresh while the initialization still runs, so the derived sets
  // reach the served metadata in the order they were derived.
  private replaceCredentialConfigurations(render = false): Promise<void> {
    const derive = () => this.deriveAndRender(render)
    const next = this.replacement.then(derive, derive)
    this.replacement = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async deriveAndRender(render: boolean): Promise<void> {
    const signingCertificate = this.signingCertificate
    if (!signingCertificate) return

    const previous = this.options.credentialConfigurations
    const derived = await this.deriveCredentialConfigurations()
    if (derived && !sameCredentialConfigurations(previous, derived)) {
      this.options.credentialConfigurations = derived
      render = true
    }
    if (!render) return

    try {
      await this.createOrUpdateIssuer(signingCertificate)
    } catch (error) {
      this.options.credentialConfigurations = previous
      throw error
    }
  }

  private async deriveCredentialConfigurations(): Promise<OpenId4VcCredentialConfiguration[] | undefined> {
    let derived: OpenId4VcCredentialConfiguration[] | undefined
    try {
      derived = await buildCredentialConfigurations(this.agent)
    } catch (error) {
      this.agent.config.logger.warn(
        `[OpenID4VC] the credential configuration set keeps its last known contents: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    if (this.unaccreditedConfigurations.size === 0) return derived

    // DEMO ONLY: keep the types the agent offers without an ISSUER Participant, also when the
    // derivation fails and the set keeps its last known contents.
    const base = derived ?? this.options.credentialConfigurations
    const extra = [...this.unaccreditedConfigurations.values()].filter(
      configuration => !base.some(existing => existing.id === configuration.id),
    )
    return [...base, ...extra]
  }

  /**
   * DEMO ONLY (AGENT_UNSAFE_SKIP_OWN_AUTHORIZATION): derive the credential type of a VTJSC for
   * which the agent holds no ISSUER Participant, add it to the issuer metadata, and return it.
   * Returns undefined when the flag is off.
   */
  /** DEMO ONLY: AGENT_UNSAFE_SKIP_OWN_AUTHORIZATION, read from the trust service of the agent. */
  private get skipsOwnAuthorization(): boolean {
    return this.agent.anonCredsTrust?.skipsOwnAuthorization === true
  }

  private async addUnaccreditedConfiguration(
    jsonSchemaCredentialId: string,
  ): Promise<OpenId4VcCredentialConfiguration | undefined> {
    if (!this.skipsOwnAuthorization) return undefined

    let configuration: OpenId4VcCredentialConfiguration
    try {
      configuration = await resolveCredentialType(this.agent, jsonSchemaCredentialId)
    } catch (error) {
      throw trustDecisionError(error, 'agent', AdminApiErrorCode.UnknownId)
    }
    this.unaccreditedConfigurations.set(configuration.id, configuration)
    this.agent.config.logger.warn(
      `[UNSAFE] the agent offers "${configuration.id}" without an ISSUER Participant, because AGENT_UNSAFE_SKIP_OWN_AUTHORIZATION is true (demo only)`,
    )
    await this.replaceCredentialConfigurations(true)
    return findCredentialConfiguration(this.options, jsonSchemaCredentialId)
  }

  /**
   * DEMO ONLY (AGENT_UNSAFE_SKIP_OWN_AUTHORIZATION): after a restart, add again the credential
   * types of the existing issuance sessions, so that a wallet can still redeem a pending offer.
   */
  private async restoreUnaccreditedConfigurations(): Promise<void> {
    if (!this.skipsOwnAuthorization) return

    const sessions = await this.sessionRepository().findByQuery(this.agent.context, {
      issuerId: ISSUER_CAPABILITY_ID,
    })
    const ids = new Set(
      sessions
        .map(session => session.getTag(JSON_SCHEMA_CREDENTIAL_ID_TAG))
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )
    for (const id of ids) {
      try {
        const configuration = await resolveCredentialType(this.agent, id)
        this.unaccreditedConfigurations.set(configuration.id, configuration)
      } catch (error) {
        this.agent.config.logger.warn(
          `[OpenID4VC] could not restore the credential type "${id}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
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
      dpopSigningAlgValuesSupported: DPOP_ALGORITHMS,
      ...(this.options.issuer?.walletAttestationCertificates?.length
        ? {
            clientAttestationSigningAlgValuesSupported: ATTESTATION_ALGORITHMS,
            clientAttestationPopSigningAlgValuesSupported: ATTESTATION_ALGORITHMS,
          }
        : {}),
      credentialConfigurationsSupported: this.credentialConfigurationsSupported(),
      metadataSigner: { method: 'x5c' as const, x5c: x5cCertificateChain(signingCertificate) },
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
    const keyAttestationsRequired = Boolean(this.options.issuer?.keyAttestationCertificates?.length)

    return Object.fromEntries(
      this.options.credentialConfigurations.map(configuration => [
        configuration.id,
        {
          format: 'dc+sd-jwt' as const,
          vct: configuration.vct,
          // `scope` is optional per OID4VCI, but a wallet whose metadata schema requires it fails resolution
          // without one.
          scope: configuration.id,
          cryptographic_binding_methods_supported: ['jwk'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
              ...(keyAttestationsRequired ? { key_attestations_required: {} } : {}),
            },
            ...(keyAttestationsRequired
              ? {
                  attestation: {
                    proof_signing_alg_values_supported: ['ES256'],
                    key_attestations_required: {},
                  },
                }
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

  private sessionRepository(): OpenId4VcIssuanceSessionRepository {
    return this.agent.context.dependencyManager.resolve(OpenId4VcIssuanceSessionRepository)
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
}

function sameCredentialConfigurations(
  one: OpenId4VcCredentialConfiguration[],
  other: OpenId4VcCredentialConfiguration[],
): boolean {
  const serialize = (configurations: OpenId4VcCredentialConfiguration[]) =>
    JSON.stringify([...configurations].sort((a, b) => a.id.localeCompare(b.id)))
  return serialize(one) === serialize(other)
}

function summarizeIssuanceSession(session: OpenId4VcIssuanceSessionRecord): OpenId4VcIssuanceSessionSummary {
  const jsonSchemaCredentialId = session.getTag(JSON_SCHEMA_CREDENTIAL_ID_TAG)
  return {
    id: session.id,
    jsonSchemaCredentialId: typeof jsonSchemaCredentialId === 'string' ? jsonSchemaCredentialId : '',
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt ?? session.createdAt,
    ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
    ...(session.errorMessage ? { errorMessage: session.errorMessage } : {}),
  }
}
