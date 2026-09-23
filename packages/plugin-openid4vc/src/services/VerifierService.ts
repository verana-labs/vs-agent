import type { OpenId4VcPluginOptions } from '../types'
import type { BaseAgent } from '@credo-ts/core'
import type { EcsClaims } from '@verana-labs/vs-agent-sdk'
import type { OpenId4VcVerificationSessionRecord, OpenId4VcVerifierApi } from '@credo-ts/openid4vc'

import { AgentContext, RecordNotFoundError } from '@credo-ts/core'
import {
  OpenId4VcVerificationSessionRepository,
  OpenId4VcVerificationSessionState,
} from '@credo-ts/openid4vc'

import {
  findCredentialConfiguration,
  UnknownCredentialConfigurationError,
  VERIFIER_CAPABILITY_ID,
} from '../config'
import {
  findBoundVerificationMethodId,
  findEd25519VerificationMethodId,
  ownDidResolutionPolicy,
  verifyKeyBoundToDid,
} from '../trust/keyBinding'
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
import { presentationQueryFor, type OpenId4VcQueryLanguage } from './presentationRequest'
import type { PresentationDecision } from './presentationVerification'

type VerifierApi = Pick<
  OpenId4VcVerifierApi,
  | 'getVerifierByVerifierId'
  | 'createVerifier'
  | 'updateVerifierMetadata'
  | 'createAuthorizationRequest'
  | 'getVerificationSessionById'
  | 'findVerificationSessionsByQuery'
  | 'deleteVerificationSessionById'
>

export type OpenId4VcVerifierAgent = Pick<
  BaseAgent,
  'dids' | 'genericRecords' | 'kms' | 'x509' | 'dependencyManager'
> & {
  did?: string
  ecsClaims?: EcsClaims
  modules: {
    openId4Vc?: {
      verifier?: VerifierApi
    }
  }
}

export type { OpenId4VcQueryLanguage } from './presentationRequest'

export interface OpenId4VcVerificationRequest {
  authorizationRequest: string
  verificationSessionId: string
}

export interface OpenId4VcCreatePresentationRequestOptions {
  jsonSchemaCredentialId: string
  requestedClaims?: string[]
  queryLanguage?: OpenId4VcQueryLanguage
  requestSigner?: 'x5c' | 'did'
}

export type { OpenId4VcVerifiedCredentialResult } from './presentationVerification'

const JSON_SCHEMA_CREDENTIAL_ID_TAG = 'jsonSchemaCredentialId'
const REQUESTED_CLAIMS_TAG = 'requestedClaims'
const OUTCOME_METADATA_KEY = 'openid4vc/verificationOutcome'

const UNDECIDED_TRUST_DECISION: PresentationDecision = {
  cryptographicVerified: true,
  accepted: false,
  trust: {
    verdict: 'RESOLVER_UNAVAILABLE',
    evidence: {
      did: null,
      trustStatus: null,
      jsonSchemaCredentialId: null,
      authorized: null,
      queries: [],
      note: 'the agent does not decide OpenID4VP trust yet; issue #712 brings the decision',
    },
  },
}

export type OpenId4VcVerificationSessionSummary = PresentationDecision & {
  id: string
  jsonSchemaCredentialId?: string
  requestedClaims?: string[]
  state: OpenId4VcVerificationSessionState
  createdAt: Date
  updatedAt: Date
  errorMessage?: string
}

export class OpenId4VcVerifierRequestError extends Error {}
export class InvalidPresentationRequestError extends Error {}
export class UnknownVerificationSessionError extends Error {}

export class VerifierService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private initialized = false

  public constructor(
    private readonly agent: OpenId4VcVerifierAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {}

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

    const configuration = findCredentialConfiguration(this.options, jsonSchemaCredentialId)
    if (!configuration) {
      throw new UnknownCredentialConfigurationError(`unknown credential type '${jsonSchemaCredentialId}'`)
    }

    const claims = requestedClaims ?? configuration.claims
    assertRequestedClaims(claims, configuration.claims)

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
    verificationSession.setTag(REQUESTED_CLAIMS_TAG, claims)
    await this.sessionRepository().update(this.agentContext(), verificationSession)

    return {
      authorizationRequest,
      verificationSessionId: verificationSession.id,
    }
  }

  public getCertificateInfo(): SigningCertificateInfo {
    return signingCertificateInfo('verifier', this.signingCertificateHandle())
  }

  public async getVerificationSession(id: string): Promise<OpenId4VcVerificationSessionSummary> {
    await this.ensureInitialized()
    const session = await this.findOwnedSession(id)
    return this.toSummary(session, this.storedDecision(session) ?? UNDECIDED_TRUST_DECISION)
  }

  public async listVerificationSessions(): Promise<OpenId4VcVerificationSessionSummary[]> {
    await this.ensureInitialized()
    const sessions = await this.verifierApi().findVerificationSessionsByQuery({
      verifierId: VERIFIER_CAPABILITY_ID,
    })
    return sessions.map(session => this.summarizeKnown(session))
  }

  public async deleteVerificationSession(id: string): Promise<void> {
    await this.ensureInitialized()
    await this.findOwnedSession(id)
    await this.verifierApi().deleteVerificationSessionById(id)
  }

  private async findOwnedSession(id: string): Promise<OpenId4VcVerificationSessionRecord> {
    const session = await this.getSession(id)
    this.assertSessionOwnership(session, id)
    return session
  }

  private summarizeKnown(session: OpenId4VcVerificationSessionRecord): OpenId4VcVerificationSessionSummary {
    const decision = this.storedDecision(session) ?? { cryptographicVerified: true, accepted: false }
    return this.toSummary(session, decision)
  }

  private toSummary(
    session: OpenId4VcVerificationSessionRecord,
    decision: PresentationDecision,
  ): OpenId4VcVerificationSessionSummary {
    const { jsonSchemaCredentialId, requestedClaims } = this.storedRequest(session)
    return {
      id: session.id,
      ...(jsonSchemaCredentialId ? { jsonSchemaCredentialId } : {}),
      ...(requestedClaims ? { requestedClaims } : {}),
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt ?? session.createdAt,
      ...(session.errorMessage ? { errorMessage: session.errorMessage } : {}),
      ...decision,
    }
  }

  private storedRequest(session: OpenId4VcVerificationSessionRecord): {
    jsonSchemaCredentialId?: string
    requestedClaims?: string[]
  } {
    const jsonSchemaCredentialId = session.getTag(JSON_SCHEMA_CREDENTIAL_ID_TAG)
    const requestedClaims = session.getTag(REQUESTED_CLAIMS_TAG)
    return {
      ...(typeof jsonSchemaCredentialId === 'string' ? { jsonSchemaCredentialId } : {}),
      ...(Array.isArray(requestedClaims) ? { requestedClaims } : {}),
    }
  }

  private storedDecision(session: OpenId4VcVerificationSessionRecord): PresentationDecision | undefined {
    if (session.state !== OpenId4VcVerificationSessionState.ResponseVerified) {
      return { cryptographicVerified: false, accepted: false }
    }
    return session.metadata.get<PresentationDecision>(OUTCOME_METADATA_KEY) ?? undefined
  }

  private sessionRepository(): OpenId4VcVerificationSessionRepository {
    return this.agent.dependencyManager.resolve(OpenId4VcVerificationSessionRepository)
  }

  private agentContext(): AgentContext {
    return this.agent.dependencyManager.resolve(AgentContext)
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
    await publishDevelopmentSigningKey(this.agent, signingCertificate, 'verifier')

    const binding = await verifyKeyBoundToDid(
      this.agent,
      agentDid,
      signingCertificate.certificate.publicJwk.toJson(),
      ['authentication'],
      ownDidResolutionPolicy(agentDid),
    )
    if (binding === 'unresolvable') {
      throw new Error('OpenID4VC verifier DID could not be resolved for authentication key binding')
    }
    if (binding !== 'bound') {
      throw new Error('OpenID4VC verifier certificate key is not bound to the agent DID authentication')
    }

    await this.createOrUpdateVerifier()
    this.signingCertificate = signingCertificate
    this.initialized = true
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

  private async getSession(sessionId: string): Promise<OpenId4VcVerificationSessionRecord> {
    try {
      return await this.verifierApi().getVerificationSessionById(sessionId)
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw new UnknownVerificationSessionError(
          `OpenID4VC verification session '${sessionId}' was not found`,
        )
      }
      throw error
    }
  }

  private assertSessionOwnership(session: OpenId4VcVerificationSessionRecord, sessionId: string): void {
    if (session.verifierId !== VERIFIER_CAPABILITY_ID) {
      throw new UnknownVerificationSessionError(`OpenID4VC verification session '${sessionId}' was not found`)
    }
  }

  private verifierApi(): VerifierApi {
    const verifier = this.agent.modules.openId4Vc?.verifier
    if (!verifier) throw new Error('OpenID4VC verifier API is not enabled on this agent')
    return verifier
  }

  private signingCertificateHandle(): SigningCertificateHandle {
    if (!this.initialized || !this.signingCertificate) {
      throw new Error('OpenID4VC verifier service is not initialized')
    }
    return this.signingCertificate
  }

  private async buildRequestSigner(queryLanguage: OpenId4VcQueryLanguage, override?: 'x5c' | 'did') {
    const certificate = this.signingCertificateHandle()
    if (override !== 'did') {
      return {
        method: 'x5c' as const,
        x5c: x5cCertificateChain(certificate),
        clientIdPrefix: 'x509_hash' as const,
      }
    }

    const did = this.agent.did ?? null

    // Presentation Exchange requests sign with the agent's Ed25519 authentication key: MOSIP's RequestSigningAlgorithm enum only has EdDSA.
    if (queryLanguage === 'presentation_exchange') {
      const ed25519DidUrl = await findEd25519VerificationMethodId(
        this.agent,
        did,
        ['authentication'],
        ownDidResolutionPolicy(did ?? ''),
      )
      if (ed25519DidUrl) return { method: 'did' as const, didUrl: ed25519DidUrl }
    }

    const didUrl = await findBoundVerificationMethodId(
      this.agent,
      did,
      certificate.certificate.publicJwk.toJson(),
      ['authentication'],
      ownDidResolutionPolicy(did ?? ''),
    )
    if (!didUrl) {
      throw new OpenId4VcVerifierRequestError(
        'verifier is configured to sign requests with its DID, but the DID does not publish the signing key for authentication',
      )
    }

    return { method: 'did' as const, didUrl }
  }
}

function assertRequestedClaims(requestedClaims: string[], configuredClaims: string[]): void {
  if (new Set(requestedClaims).size !== requestedClaims.length) {
    throw new InvalidPresentationRequestError('requestedClaims must not contain a duplicate')
  }

  const unknownClaim = requestedClaims.find(claim => !configuredClaims.includes(claim))
  if (unknownClaim) {
    throw new InvalidPresentationRequestError(`unknown claim '${unknownClaim}'`)
  }
}
