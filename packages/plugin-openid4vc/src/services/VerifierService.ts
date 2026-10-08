import type { OpenId4VcAgent, OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../types'
import type { OnModuleInit } from '@nestjs/common'
import type { SdJwtVc } from '@credo-ts/core'
import type { OpenId4VcVerificationSessionRecord, OpenId4VcVerifierApi } from '@credo-ts/openid4vc'
import type { DidTrustResolver } from '@verana-labs/vs-agent-sdk'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { Inject, Injectable } from '@nestjs/common'
import {
  OpenId4VcVerificationSessionRepository,
  OpenId4VcVerificationSessionState,
} from '@credo-ts/openid4vc'
import {
  AdminApiError,
  AdminApiErrorCode,
  fetchBoundedBytes,
  ParticipantRole,
  trustDecisionError,
} from '@verana-labs/vs-agent-sdk'

import { VERIFIER_CAPABILITY_ID } from '../config'
import { findBoundVerificationMethodId, verifyKeyBoundToDid } from '../trust/keyBinding'
import { trustedIssuersForPresentation } from '../trust/presentedIssuer'
import { decidePresentationTrust, type PresentationTrustRequest } from '../trust/trustDecision'
import { OPENID4VC_DID_TRUST_RESOLVER, OPENID4VC_OPTIONS } from '../types'
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
import { resolveCredentialType } from './credentialConfigurationBuilder'
import { presentationQueryFor, type OpenId4VcQueryLanguage } from './presentationRequest'
import type { PresentationDecision } from './presentationVerification'

type VerifierApi = Pick<
  OpenId4VcVerifierApi,
  | 'getVerifierByVerifierId'
  | 'createVerifier'
  | 'updateVerifierMetadata'
  | 'createAuthorizationRequest'
  | 'getVerificationSessionById'
  | 'getVerifiedAuthorizationResponse'
  | 'findVerificationSessionsByQuery'
  | 'deleteVerificationSessionById'
>

export interface OpenId4VcVerificationRequest {
  authorizationRequest: string
  verificationSessionId: string
}

export interface OpenId4VcVerificationSessionFilters {
  jsonSchemaCredentialId?: string
  state?: OpenId4VcVerificationSessionState
}

export const OPENID4VC_REQUEST_SIGNERS = ['x5c', 'did'] as const

export type OpenId4VcRequestSigner = (typeof OPENID4VC_REQUEST_SIGNERS)[number]

export interface OpenId4VcCreatePresentationRequestOptions {
  jsonSchemaCredentialId: string
  requestedClaims?: string[]
  queryLanguage?: OpenId4VcQueryLanguage
  requestSigner?: OpenId4VcRequestSigner
}

const BAD_REQUEST = 400
const NOT_FOUND = 404
const CONFLICT = 409

const JSON_SCHEMA_CREDENTIAL_ID_TAG = 'jsonSchemaCredentialId'
const CREDENTIAL_SCHEMA_ID_TAG = 'credentialSchemaId'
const REQUESTED_CLAIMS_TAG = 'requestedClaims'
const OUTCOME_METADATA_KEY = 'openid4vc/verificationOutcome'

const UNVERIFIED: PresentationDecision = { cryptographicVerified: false, accepted: false }
const UNDECIDED: PresentationDecision = { cryptographicVerified: true, accepted: false }

export type OpenId4VcVerificationSessionSummary = PresentationDecision & {
  id: string
  jsonSchemaCredentialId?: string
  requestedClaims?: string[]
  state: OpenId4VcVerificationSessionState
  createdAt: Date
  updatedAt: Date
  errorMessage?: string
}

@Injectable()
export class VerifierService implements OnModuleInit {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle

  public constructor(
    @Inject('VSAGENT') private readonly agent: OpenId4VcAgent,
    @Inject(OPENID4VC_OPTIONS) private readonly options: OpenId4VcPluginOptions,
    @Inject(OPENID4VC_DID_TRUST_RESOLVER) private readonly resolveDidTrust: DidTrustResolver,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.ensureInitialized()
  }

  public ensureInitialized(): Promise<void> {
    this.initialization ??= this.initialize().catch(error => {
      this.initialization = undefined
      throw error
    })
    return this.initialization
  }

  public async createRequest({
    jsonSchemaCredentialId,
    requestedClaims,
    queryLanguage = 'dcql',
    requestSigner,
  }: OpenId4VcCreatePresentationRequestOptions): Promise<OpenId4VcVerificationRequest> {
    await this.ensureInitialized()

    let configuration: OpenId4VcCredentialConfiguration
    try {
      configuration = await resolveCredentialType(this.agent, jsonSchemaCredentialId)
    } catch (error) {
      throw trustDecisionError(error, 'agent', AdminApiErrorCode.UnknownId)
    }

    const claims = requestedClaims ?? configuration.claims
    assertRequestedClaims(claims, configuration.claims)

    // [VSA-VTI-FLOW-VERIFY-AC-5] for OpenID4VP: the agent asks for a type only where the Ecosystem
    // accredits it as a verifier
    try {
      await this.agent.anonCredsTrust.assertOwnAuthorization({
        role: ParticipantRole.Verifier,
        credentialSchemaId: configuration.credentialSchemaId,
      })
    } catch (error) {
      throw trustDecisionError(error, 'agent')
    }

    const { authorizationRequest, verificationSession } = await this.verifierApi().createAuthorizationRequest(
      {
        verifierId: VERIFIER_CAPABILITY_ID,
        requestSigner: await this.buildRequestSigner(queryLanguage, requestSigner),
        // JARM (direct_post.jwt) is DCQL-only: Presentation Exchange wallets can't build the JWE it needs.
        responseMode: queryLanguage === 'presentation_exchange' ? 'direct_post' : 'direct_post.jwt',
        ...presentationQueryFor(configuration, claims, queryLanguage),
      },
    )

    verificationSession.setTag(JSON_SCHEMA_CREDENTIAL_ID_TAG, jsonSchemaCredentialId)
    verificationSession.setTag(CREDENTIAL_SCHEMA_ID_TAG, String(configuration.credentialSchemaId))
    verificationSession.setTag(REQUESTED_CLAIMS_TAG, claims)
    await this.sessionRepository().update(this.agent.context, verificationSession)

    return {
      authorizationRequest,
      verificationSessionId: verificationSession.id,
    }
  }

  public async getCertificateInfo(): Promise<SigningCertificateInfo> {
    await this.ensureInitialized()
    return signingCertificateInfo('verifier', this.signingCertificateHandle())
  }

  public async getVerificationSession(id: string): Promise<OpenId4VcVerificationSessionSummary> {
    await this.ensureInitialized()
    const session = await this.findOwnedSession(id)
    return this.toSummary(session, await this.decide(session))
  }

  // [VSA-ADM-OID-PR-LIST]: a list reports the stored verdict and never decides
  public async listVerificationSessions(
    filters: OpenId4VcVerificationSessionFilters = {},
  ): Promise<OpenId4VcVerificationSessionSummary[]> {
    await this.ensureInitialized()
    const sessions = await this.verifierApi().findVerificationSessionsByQuery({
      verifierId: VERIFIER_CAPABILITY_ID,
      state: filters.state,
      [JSON_SCHEMA_CREDENTIAL_ID_TAG]: filters.jsonSchemaCredentialId,
    })
    return sessions.map(session => this.toSummary(session, this.storedDecision(session) ?? UNDECIDED))
  }

  public async deleteVerificationSession(id: string): Promise<void> {
    await this.ensureInitialized()
    await this.findOwnedSession(id)
    await this.verifierApi().deleteVerificationSessionById(id)
  }

  private async findOwnedSession(id: string): Promise<OpenId4VcVerificationSessionRecord> {
    let session: OpenId4VcVerificationSessionRecord
    try {
      session = await this.verifierApi().getVerificationSessionById(id)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw new AdminApiError(AdminApiErrorCode.UnknownId, NOT_FOUND, `no presentation with id "${id}"`)
      }
      throw error
    }
    if (session.verifierId !== VERIFIER_CAPABILITY_ID) {
      throw new AdminApiError(AdminApiErrorCode.UnknownId, NOT_FOUND, `no presentation with id "${id}"`)
    }
    return session
  }

  // [VSA-ADM-OID-PR-GET]: the verdict is computed once, on the first read of a verified session, and
  // stored with it; RESOLVER_UNAVAILABLE is never stored, so the next read retries the resolver
  private async decide(session: OpenId4VcVerificationSessionRecord): Promise<PresentationDecision> {
    const stored = this.storedDecision(session)
    if (stored) return stored

    const decision = await decidePresentationTrust(
      await this.presentedCredential(session),
      this.storedRequest(session),
      {
        agent: this.agent,
        readTypeMetadata: vct => fetchBoundedBytes(vct),
        resolveDidTrust: this.resolveDidTrust,
        assertAuthorized: options => this.agent.anonCredsTrust.assertAuthorized(options),
      },
    )
    if (decision.trust?.verdict !== 'RESOLVER_UNAVAILABLE') {
      session.metadata.set(OUTCOME_METADATA_KEY, decision)
      await this.sessionRepository().update(this.agent.context, session)
    }
    return decision
  }

  private async presentedCredential(session: OpenId4VcVerificationSessionRecord): Promise<SdJwtVc> {
    const verified = await this.verifierApi().getVerifiedAuthorizationResponse(session.id)
    const presentations = [
      ...Object.values(verified.dcql?.presentations ?? {}).flat(),
      ...(verified.presentationExchange?.presentations ?? []),
    ]
    const credential = presentations.find(
      (presentation): presentation is SdJwtVc => presentation.claimFormat === ClaimFormat.SdJwtDc,
    )
    if (!credential) throw new Error(`the verification session "${session.id}" carries no SD-JWT VC`)
    return credential
  }

  private toSummary(
    session: OpenId4VcVerificationSessionRecord,
    decision: PresentationDecision,
  ): OpenId4VcVerificationSessionSummary {
    const jsonSchemaCredentialId = session.getTag(JSON_SCHEMA_CREDENTIAL_ID_TAG)
    const requestedClaims = session.getTag(REQUESTED_CLAIMS_TAG)
    return {
      id: session.id,
      ...(typeof jsonSchemaCredentialId === 'string' ? { jsonSchemaCredentialId } : {}),
      ...(Array.isArray(requestedClaims) ? { requestedClaims } : {}),
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt ?? session.createdAt,
      ...(session.errorMessage ? { errorMessage: session.errorMessage } : {}),
      ...decision,
    }
  }

  private storedRequest(session: OpenId4VcVerificationSessionRecord): PresentationTrustRequest {
    const jsonSchemaCredentialId = session.getTag(JSON_SCHEMA_CREDENTIAL_ID_TAG)
    const credentialSchemaId = session.getTag(CREDENTIAL_SCHEMA_ID_TAG)
    if (typeof jsonSchemaCredentialId !== 'string' || typeof credentialSchemaId !== 'string') {
      throw new Error(`the verification session "${session.id}" carries no credential type`)
    }
    return { jsonSchemaCredentialId, credentialSchemaId: Number(credentialSchemaId) }
  }

  private storedDecision(session: OpenId4VcVerificationSessionRecord): PresentationDecision | undefined {
    if (session.state !== OpenId4VcVerificationSessionState.ResponseVerified) return UNVERIFIED
    return session.metadata.get<PresentationDecision>(OUTCOME_METADATA_KEY) ?? undefined
  }

  private sessionRepository(): OpenId4VcVerificationSessionRepository {
    return this.agent.context.dependencyManager.resolve(OpenId4VcVerificationSessionRepository)
  }

  private async initialize(): Promise<void> {
    const agentDid = this.agent.did
    if (!agentDid) throw new Error('OpenID4VC verifier initialization requires an agent DID')

    const signingCertificate = await loadSigningCertificate(
      this.agent,
      this.options.verifier?.signing,
      this.options.publicApiBaseUrl,
      'verifier',
    )
    const certificateDid = didFromValidatedCertificate(signingCertificate.certificate)
    if (certificateDid !== agentDid) {
      throw new Error('OpenID4VC verifier certificate DID does not match the agent DID')
    }
    const publishedMethodId = await publishDevelopmentSigningKey(this.agent, signingCertificate, 'verifier')

    const binding = await verifyKeyBoundToDid(
      this.agent,
      agentDid,
      signingCertificate.certificate.publicJwk.toJson(),
      ['authentication'],
    )
    if (binding === 'unresolvable') {
      throw new Error('OpenID4VC verifier DID could not be resolved for authentication key binding')
    }
    if (binding !== 'bound') {
      throw new Error('OpenID4VC verifier certificate key is not bound to the agent DID authentication')
    }

    this.agent.config.setTrustedIssuersForVerification(trustedIssuersForPresentation)
    await this.createOrUpdateVerifier()
    this.signingCertificate = signingCertificate
    this.agent.config.logger.info(
      `[OpenID4VC] verifier signs with a ${signingCertificate.development ? 'development' : 'configured'} certificate${publishedMethodId ? `, published as ${publishedMethodId}` : ''}`,
    )
  }

  private async createOrUpdateVerifier(): Promise<void> {
    const display = serviceDisplay(this.agent)
    const metadata = {
      verifierId: VERIFIER_CAPABILITY_ID,
      ...(display
        ? {
            clientMetadata: {
              client_name: display.name,
              ...(display.logoUri ? { logo_uri: display.logoUri } : {}),
            },
          }
        : {}),
    }

    try {
      await this.verifierApi().getVerifierByVerifierId(VERIFIER_CAPABILITY_ID)
    } catch (error) {
      if (!(error instanceof RecordNotFoundError)) throw error
      await this.verifierApi().createVerifier(metadata)
      return
    }

    await this.verifierApi().updateVerifierMetadata(metadata)
  }

  private verifierApi(): VerifierApi {
    const verifier = this.agent.modules.openId4Vc?.verifier
    if (!verifier) throw new Error('OpenID4VC verifier API is not enabled on this agent')
    return verifier
  }

  private signingCertificateHandle(): SigningCertificateHandle {
    const signingCertificate = this.signingCertificate
    if (!signingCertificate) throw new Error('OpenID4VC verifier service is not initialized')
    return signingCertificate
  }

  private async buildRequestSigner(queryLanguage: OpenId4VcQueryLanguage, override?: OpenId4VcRequestSigner) {
    const certificate = this.signingCertificateHandle()
    if (override !== 'did') {
      const host = new URL(this.options.publicApiBaseUrl).hostname
      if (queryLanguage === 'presentation_exchange' && !certificate.certificate.sanDnsNames.includes(host)) {
        throw new AdminApiError(
          AdminApiErrorCode.InvalidState,
          CONFLICT,
          `a presentation_exchange request needs a verifier certificate that carries ${host} as a DNS SAN`,
        )
      }
      return {
        method: 'x5c' as const,
        x5c: x5cCertificateChain(certificate),
        // Draft 21 predates x509_hash: Credo would send client_id_scheme=x509_hash and then refuse to parse its own request.
        clientIdPrefix:
          queryLanguage === 'presentation_exchange' ? ('x509_san_dns' as const) : ('x509_hash' as const),
      }
    }

    const did = this.agent.did ?? null

    const didUrl = await findBoundVerificationMethodId(
      this.agent,
      did,
      certificate.certificate.publicJwk.toJson(),
      ['authentication'],
    )
    if (!didUrl) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        CONFLICT,
        'verifier is configured to sign requests with its DID, but the DID does not publish the signing key for authentication',
      )
    }

    return { method: 'did' as const, didUrl }
  }
}

function assertRequestedClaims(requestedClaims: string[], configuredClaims: string[]): void {
  if (new Set(requestedClaims).size !== requestedClaims.length) {
    throw new AdminApiError(
      AdminApiErrorCode.InvalidInput,
      BAD_REQUEST,
      'requestedClaims must not contain a duplicate',
    )
  }

  const unknownClaim = requestedClaims.find(claim => !configuredClaims.includes(claim))
  if (unknownClaim) {
    throw new AdminApiError(AdminApiErrorCode.InvalidInput, BAD_REQUEST, `unknown claim '${unknownClaim}'`)
  }
}
