import type { OpenId4VcAgent, OpenId4VcPluginOptions } from '../types'
import type { Kms } from '@credo-ts/core'
import type {
  OpenId4VcIssuanceSessionRecord,
  OpenId4VcIssuanceSessionState,
  OpenId4VcIssuerApi,
  OpenId4VciCredentialConfigurationsSupportedWithFormats,
  OpenId4VciCredentialRequestToCredentialMapper,
} from '@credo-ts/openid4vc'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'
import { AdminApiError, AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import {
  findCredentialConfiguration,
  ISSUER_CAPABILITY_ID,
  parseOfferClaims,
  parseOfferIssuanceMetadata,
  parseOfferTtlSeconds,
} from '../config'
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
  statusListId?: string
  state?: OpenId4VcIssuanceSessionState
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

const BAD_REQUEST = 400
const NOT_FOUND = 404

const JSON_SCHEMA_CREDENTIAL_ID_TAG = 'jsonSchemaCredentialId'
const STATUS_LIST_ID_TAG = 'statusListId'
const DPOP_ALGORITHMS: [Kms.KnownJwaSignatureAlgorithm] = ['ES256']
const ATTESTATION_ALGORITHMS: [Kms.KnownJwaSignatureAlgorithm] = ['ES256']

export class IssuerService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private initialized = false

  public constructor(
    private readonly agent: OpenId4VcAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

  public ensureInitialized(): Promise<void> {
    // A rejected initialization is not cached, so a transient boot-time failure retries instead of wedging
    // the process until restart.
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
      )
    }

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
      [STATUS_LIST_ID_TAG]: filters.statusListId,
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
    this.assertInitialized()
    return {
      issuer: this.options.publicApiBaseUrl,
      jwks: { keys: [this.signingCertificateHandle().certificate.publicJwk.toJson()] },
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

    this.signingCertificate = signingCertificate
    this.initialized = true
  }

  private metadataSigner(signingCertificate: SigningCertificateHandle) {
    return { method: 'x5c' as const, x5c: x5cCertificateChain(signingCertificate) }
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
          // Only `jwt` is on the record: a wallet modelling `proof_types_supported` as a closed enum throws
          // on any other member.
          proof_types_supported: {
            jwt: {
              proof_signing_alg_values_supported: ['ES256'],
              ...(keyAttestationsRequired ? { key_attestations_required: {} } : {}),
            },
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

  private assertInitialized(): void {
    if (!this.initialized || !this.signingCertificate) {
      throw new Error('OpenID4VC issuer service is not initialized')
    }
  }
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
