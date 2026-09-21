import type { OpenId4VcPluginOptions } from '../types'
import type { BaseAgent } from '@credo-ts/core'
import type {
  OpenId4VcVerificationSessionRecord,
  OpenId4VcVerifierApi,
  OpenId4VpVerifiedAuthorizationResponse,
} from '@credo-ts/openid4vc'

import { AgentContext, RecordNotFoundError } from '@credo-ts/core'
import {
  OpenId4VcVerificationSessionRepository,
  OpenId4VcVerificationSessionState,
} from '@credo-ts/openid4vc'

import { findCredentialConfiguration, findVerifierPolicy, VERIFIER_CAPABILITY_ID } from '../config'
import { TrustClient } from '../trust/TrustClient'
import {
  findBoundVerificationMethodId,
  findEd25519VerificationMethodId,
  ownDidResolutionPolicy,
  verifyKeyBoundToDid,
} from '../trust/keyBinding'
import { publishParallelWebSigningKey } from '../trust/parallelWebSigningKey'

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
import { decidePresentation, type PresentationDecision } from './presentationVerification'

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

export type OpenId4VcVerifierAgent = Pick<
  BaseAgent,
  'dids' | 'genericRecords' | 'kms' | 'x509' | 'dependencyManager'
> & {
  did?: string
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

export type { OpenId4VcVerifiedCredentialResult } from './presentationVerification'

const POLICY_TAG = 'policyId'
const OUTCOME_METADATA_KEY = 'openid4vc/verificationOutcome'

export type OpenId4VcVerificationSessionSummary = PresentationDecision & {
  id: string
  policyId?: string
  state: OpenId4VcVerificationSessionState
  createdAt: Date
  updatedAt: Date
  errorMessage?: string
}

export class OpenId4VcVerifierRequestError extends Error {}
export class UnknownVerifierPolicyError extends Error {}
export class UnknownVerificationSessionError extends Error {}

export class VerifierService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
  private parallelWebSigningDidUrl?: string
  private initialized = false
  private readonly trustClient: TrustClient

  public constructor(
    private readonly agent: OpenId4VcVerifierAgent,
    private readonly options: OpenId4VcPluginOptions,
  ) {
    const trust = this.options.trust
    if (!trust) throw new Error('OpenID4VC verifier requires trust configuration')
    this.trustClient = new TrustClient(trust)
  }

  public ensureInitialized(): Promise<void> {
    this.initialization ??= this.initialize().catch(error => {
      this.initialization = undefined
      throw error
    })
    return this.initialization
  }

  public async createRequest(
    policyId: string,
    queryLanguage: OpenId4VcQueryLanguage = 'dcql',
    requestSigner?: 'x5c' | 'did',
  ): Promise<OpenId4VcVerificationRequest> {
    await this.ensureInitialized()

    const policy = findVerifierPolicy(this.options, policyId)
    if (!policy) {
      throw new UnknownVerifierPolicyError(`unknown verifier policy '${policyId}'`)
    }
    const configuration = findCredentialConfiguration(this.options, policy.credentialConfigurationId)
    if (!configuration) {
      throw new Error(`verifier policy '${policyId}' references an unknown credential configuration`)
    }

    const { authorizationRequest, verificationSession } = await this.verifierApi().createAuthorizationRequest(
      {
        verifierId: VERIFIER_CAPABILITY_ID,
        requestSigner: await this.buildRequestSigner(queryLanguage, requestSigner),
        // JARM (direct_post.jwt) is DCQL-only: Presentation Exchange wallets can't build the JWE it needs.
        responseMode: queryLanguage === 'presentation_exchange' ? 'direct_post' : 'direct_post.jwt',
        ...presentationQueryFor(configuration, policy, queryLanguage),
      },
    )

    verificationSession.setTag(POLICY_TAG, policyId)
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
    return this.summarize(await this.findOwnedSession(id))
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

  private async summarize(
    session: OpenId4VcVerificationSessionRecord,
  ): Promise<OpenId4VcVerificationSessionSummary> {
    return this.toSummary(session, await this.decisionFor(session))
  }

  private summarizeKnown(session: OpenId4VcVerificationSessionRecord): OpenId4VcVerificationSessionSummary {
    const decision = this.storedDecision(session) ?? { cryptographicVerified: true, accepted: false }
    return this.toSummary(session, decision)
  }

  private toSummary(
    session: OpenId4VcVerificationSessionRecord,
    decision: PresentationDecision,
  ): OpenId4VcVerificationSessionSummary {
    const policyId = session.getTag(POLICY_TAG)
    return {
      id: session.id,
      ...(typeof policyId === 'string' ? { policyId } : {}),
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt ?? session.createdAt,
      ...(session.errorMessage ? { errorMessage: session.errorMessage } : {}),
      ...decision,
    }
  }

  private storedDecision(session: OpenId4VcVerificationSessionRecord): PresentationDecision | undefined {
    if (session.state !== OpenId4VcVerificationSessionState.ResponseVerified) {
      return { cryptographicVerified: false, accepted: false }
    }
    return session.metadata.get<PresentationDecision>(OUTCOME_METADATA_KEY) ?? undefined
  }

  private async decisionFor(session: OpenId4VcVerificationSessionRecord): Promise<PresentationDecision> {
    const stored = this.storedDecision(session)
    if (stored) return stored

    const verified = await this.getVerifiedResponse(session.id)
    this.assertStableVerifiedSession(verified, session.id)
    const decision = await decidePresentation({
      agent: this.agent,
      options: this.options,
      trust: this.trustOptions(),
      trustClient: this.trustClient,
      verified,
    })
    if (decision.trust?.verdict !== 'RESOLVER_UNAVAILABLE') {
      session.metadata.set(OUTCOME_METADATA_KEY, decision)
      await this.sessionRepository().update(this.agentContext(), session)
    }
    return decision
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
      this.verifierOptions().signing,
      this.options.publicApiBaseUrl,
      'verifier',
    )
    const certificateDid = didFromValidatedCertificate(signingCertificate.certificate)
    if (certificateDid !== agentDid) {
      throw new Error('OpenID4VC verifier certificate DID does not match the agent DID')
    }
    await publishDevelopmentSigningKey(this.agent, signingCertificate, 'verifier')

    this.parallelWebSigningDidUrl = await publishParallelWebSigningKey(
      this.agent,
      this.trustOptions().timeoutMs,
    )

    const binding = await verifyKeyBoundToDid(
      this.agent,
      agentDid,
      signingCertificate.certificate.publicJwk.toJson(),
      ['authentication'],
      ownDidResolutionPolicy(agentDid, this.trustOptions().timeoutMs),
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
    const verifier = this.verifierOptions()
    const metadata = {
      verifierId: VERIFIER_CAPABILITY_ID,
      clientMetadata: { client_name: verifier.displayName },
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

  private async getVerifiedResponse(sessionId: string): Promise<OpenId4VpVerifiedAuthorizationResponse> {
    try {
      return await this.verifierApi().getVerifiedAuthorizationResponse(sessionId)
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

  private assertStableVerifiedSession(
    verified: OpenId4VpVerifiedAuthorizationResponse,
    sessionId: string,
  ): void {
    if (
      verified.verificationSession.id !== sessionId ||
      verified.verificationSession.verifierId !== VERIFIER_CAPABILITY_ID ||
      verified.verificationSession.state !== OpenId4VcVerificationSessionState.ResponseVerified
    ) {
      throw new Error('OpenID4VC verification session changed while reading its verified result')
    }
  }

  private verifierApi(): VerifierApi {
    const verifier = this.agent.modules.openId4Vc?.verifier
    if (!verifier) throw new Error('OpenID4VC verifier API is not enabled on this agent')
    return verifier
  }

  private verifierOptions(): NonNullable<OpenId4VcPluginOptions['verifier']> {
    const verifier = this.options.verifier
    if (!verifier) throw new Error('OpenID4VC verifier capability is not configured')
    return verifier
  }

  private trustOptions(): NonNullable<OpenId4VcPluginOptions['trust']> {
    const trust = this.options.trust
    if (!trust) throw new Error('OpenID4VC verifier requires trust configuration')
    return trust
  }

  private signingCertificateHandle(): SigningCertificateHandle {
    if (!this.initialized || !this.signingCertificate) {
      throw new Error('OpenID4VC verifier service is not initialized')
    }
    return this.signingCertificate
  }

  private async buildRequestSigner(queryLanguage: OpenId4VcQueryLanguage, override?: 'x5c' | 'did') {
    const certificate = this.signingCertificateHandle()
    if ((override ?? this.verifierOptions().requestSigner) !== 'did') {
      return {
        method: 'x5c' as const,
        x5c: x5cCertificateChain(certificate),
        clientIdPrefix: 'x509_hash' as const,
      }
    }

    const did = this.agent.did ?? null

    // Presentation Exchange requests sign with the Ed25519 parallel did:web key: MOSIP verifies EdDSA over did:web only, never did:webvh.
    if (queryLanguage === 'presentation_exchange') {
      if (this.parallelWebSigningDidUrl) {
        return { method: 'did' as const, didUrl: this.parallelWebSigningDidUrl }
      }
      const ed25519DidUrl = await findEd25519VerificationMethodId(
        this.agent,
        did,
        ['authentication'],
        ownDidResolutionPolicy(did ?? '', this.trustOptions().timeoutMs),
      )
      if (ed25519DidUrl) return { method: 'did' as const, didUrl: ed25519DidUrl }
    }

    const didUrl = await findBoundVerificationMethodId(
      this.agent,
      did,
      certificate.certificate.publicJwk.toJson(),
      ['authentication'],
      ownDidResolutionPolicy(did ?? '', this.trustOptions().timeoutMs),
    )
    if (!didUrl) {
      throw new OpenId4VcVerifierRequestError(
        'verifier is configured to sign requests with its DID, but the DID does not publish the signing key for authentication',
      )
    }

    return { method: 'did' as const, didUrl }
  }
}
