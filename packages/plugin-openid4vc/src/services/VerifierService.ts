import type { TrustVerdict } from '../trust/types'
import type { OpenId4VcPluginOptions, OpenId4VcVerifierPolicy } from '../types'
import type { BaseAgent, SdJwtVc, X509Certificate } from '@credo-ts/core'
import type {
  OpenId4VcVerificationSessionRecord,
  OpenId4VcVerifierApi,
  OpenId4VpVerifiedAuthorizationResponse,
} from '@credo-ts/openid4vc'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcVerificationSessionState } from '@credo-ts/openid4vc'

import { findCredentialConfiguration, findVerifierPolicy } from '../config'
import { TrustClient } from '../trust/TrustClient'
import { blockingBindingVerdict, ownDidResolutionPolicy, verifyKeyBoundToDid } from '../trust/keyBinding'

import {
  didFromValidatedCertificate,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  type SigningCertificateHandle,
} from './CertificateService'

type VerifierApi = Pick<
  OpenId4VcVerifierApi,
  | 'getVerifierByVerifierId'
  | 'createVerifier'
  | 'updateVerifierMetadata'
  | 'createAuthorizationRequest'
  | 'getVerificationSessionById'
  | 'getVerifiedAuthorizationResponse'
>

export type OpenId4VcVerifierAgent = Pick<BaseAgent, 'dids' | 'genericRecords' | 'kms' | 'x509'> & {
  did?: string
  modules: {
    openId4Vc?: {
      verifier?: VerifierApi
    }
  }
}

export interface OpenId4VcVerificationRequest {
  authorizationRequest: string
  verificationSessionId: string
}

export interface OpenId4VcVerifiedCredentialResult {
  vct: string
  disclosedClaims: Record<string, unknown>
}

export interface OpenId4VcVerificationResult {
  state: OpenId4VcVerificationSessionRecord['state']
  cryptographicVerified: boolean
  accepted: boolean
  trust?: TrustVerdict
  credential?: OpenId4VcVerifiedCredentialResult
}

export class OpenId4VcVerifierRequestError extends Error {}
export class UnknownVerificationSessionError extends Error {}

export class VerifierService {
  private initialization?: Promise<void>
  private signingCertificate?: SigningCertificateHandle
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
    this.initialization ??= this.initialize()
    return this.initialization
  }

  public async createRequest(policyId: string): Promise<OpenId4VcVerificationRequest> {
    await this.ensureInitialized()

    const policy = findVerifierPolicy(this.options, policyId)
    if (!policy) {
      throw new OpenId4VcVerifierRequestError(`unknown verifier policy '${policyId}'`)
    }
    const configuration = findCredentialConfiguration(this.options, policy.credentialConfigurationId)
    if (!configuration) {
      throw new OpenId4VcVerifierRequestError(
        `verifier policy '${policyId}' references an unknown credential configuration`,
      )
    }

    const { authorizationRequest, verificationSession } = await this.verifierApi().createAuthorizationRequest(
      {
        verifierId: this.verifierOptions().id,
        requestSigner: {
          method: 'x5c',
          x5c: this.signingCertificateHandle().chain,
          clientIdPrefix: 'x509_hash',
        },
        responseMode: 'direct_post.jwt',
        dcql: {
          query: {
            credentials: [
              {
                id: configuration.id,
                format: 'dc+sd-jwt',
                meta: { vct_values: [configuration.vct] },
                claims: policy.requestedClaims.map(name => ({ path: [name] })),
              },
            ],
          },
        },
      },
    )

    return {
      authorizationRequest,
      verificationSessionId: verificationSession.id,
    }
  }

  public async getResult(sessionId: string): Promise<OpenId4VcVerificationResult> {
    const session = await this.getSession(sessionId)
    this.assertSessionOwnership(session, sessionId)

    if (session.state !== OpenId4VcVerificationSessionState.ResponseVerified) {
      return {
        state: session.state,
        cryptographicVerified: false,
        accepted: false,
      }
    }

    const verified = await this.getVerifiedResponse(sessionId)
    this.assertStableVerifiedSession(verified, sessionId)

    const matched = this.matchConfiguredPolicy(verified)
    if (!matched) {
      return this.blockedResult(session.state, null, null, 'unbound')
    }

    const { policy } = matched
    const configuration = findCredentialConfiguration(this.options, policy.credentialConfigurationId)
    if (!configuration) {
      return this.blockedResult(session.state, null, null, 'unbound')
    }

    const presentation = verified.dcql?.presentations[configuration.id]?.[0]
    if (!isX5cSdJwtDcPresentation(presentation)) {
      return this.blockedResult(session.state, null, configuration.vtjscId, 'unbound')
    }

    const disclosedClaims = configuredDisclosedClaims(presentation.prettyClaims, policy.requestedClaims)
    if (presentation.prettyClaims.vct !== configuration.vct || !disclosedClaims) {
      return this.blockedResult(session.state, null, configuration.vtjscId, 'unbound')
    }

    const issuerCertificate = presentation.issuer.x5c[0]
    let issuerDid: string
    let issuerPublicJwk: unknown
    try {
      issuerDid = didFromValidatedCertificate(issuerCertificate)
      issuerPublicJwk = issuerCertificate.publicJwk.toJson()
    } catch {
      return this.blockedResult(session.state, null, configuration.vtjscId, 'unbound')
    }

    const credential = { vct: configuration.vct, disclosedClaims }
    const binding = await verifyKeyBoundToDid(this.agent, issuerDid, issuerPublicJwk, ['assertionMethod'], {
      allowedWebHosts: this.trustOptions().allowedDidWebHosts,
      timeoutMs: this.trustOptions().timeoutMs,
    })
    if (binding !== 'bound') {
      return {
        state: session.state,
        cryptographicVerified: true,
        accepted: false,
        trust: blockingBindingVerdict(issuerDid, configuration.vtjscId, binding),
        credential,
      }
    }

    const trust = await this.trustClient.verdictFor('issuer', issuerDid, configuration.vtjscId)
    return {
      state: session.state,
      cryptographicVerified: true,
      accepted: trust.verdict === 'TRUSTED_AUTHORIZED',
      trust,
      credential,
    }
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
      verifierId: verifier.id,
      clientMetadata: { client_name: verifier.displayName },
    }

    try {
      await this.verifierApi().getVerifierByVerifierId(verifier.id)
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
    if (session.verifierId !== this.verifierOptions().id) {
      throw new UnknownVerificationSessionError(`OpenID4VC verification session '${sessionId}' was not found`)
    }
  }

  private assertStableVerifiedSession(
    verified: OpenId4VpVerifiedAuthorizationResponse,
    sessionId: string,
  ): void {
    if (
      verified.verificationSession.id !== sessionId ||
      verified.verificationSession.verifierId !== this.verifierOptions().id ||
      verified.verificationSession.state !== OpenId4VcVerificationSessionState.ResponseVerified
    ) {
      throw new Error('OpenID4VC verification session changed while reading its verified result')
    }
  }

  private matchConfiguredPolicy(
    verified: OpenId4VpVerifiedAuthorizationResponse,
  ): { policy: OpenId4VcVerifierPolicy } | undefined {
    const credentials = verified.dcql?.query.credentials
    if (!credentials || credentials.length !== 1) return undefined

    const query = credentials[0]
    if (query.format !== 'dc+sd-jwt') return undefined

    const configuration = findCredentialConfiguration(this.options, query.id)
    if (!configuration) return undefined
    if (query.meta?.vct_values?.length !== 1 || query.meta.vct_values[0] !== configuration.vct) {
      return undefined
    }

    const requestedClaims = query.claims?.map(claim => {
      const path = claim.path
      return path.length === 1 && typeof path[0] === 'string' ? path[0] : undefined
    })
    if (!requestedClaims || requestedClaims.some(claim => claim === undefined)) return undefined

    const policy = this.options.verifierPolicies.find(
      candidate =>
        candidate.credentialConfigurationId === configuration.id &&
        equalStrings(candidate.requestedClaims, requestedClaims),
    )
    return policy ? { policy } : undefined
  }

  private blockedResult(
    state: OpenId4VcVerificationSessionRecord['state'],
    did: string | null,
    vtjscId: string | null,
    binding: 'unbound' | 'unresolvable',
  ): OpenId4VcVerificationResult {
    return {
      state,
      cryptographicVerified: true,
      accepted: false,
      trust: blockingBindingVerdict(did, vtjscId, binding),
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
}

type X5cSdJwtDcPresentation = Pick<SdJwtVc, 'claimFormat' | 'prettyClaims'> & {
  issuer: { method: 'x5c'; x5c: [X509Certificate, ...X509Certificate[]] }
}

function isX5cSdJwtDcPresentation(value: unknown): value is X5cSdJwtDcPresentation {
  if (!isRecord(value) || value.claimFormat !== ClaimFormat.SdJwtDc || !isRecord(value.prettyClaims)) {
    return false
  }
  if (!isRecord(value.issuer) || value.issuer.method !== 'x5c' || !Array.isArray(value.issuer.x5c)) {
    return false
  }

  const leaf: unknown = value.issuer.x5c[0]
  return (
    isRecord(leaf) &&
    Array.isArray(leaf.sanUriNames) &&
    isRecord(leaf.publicJwk) &&
    typeof leaf.publicJwk.toJson === 'function'
  )
}

function configuredDisclosedClaims(
  claims: Record<string, unknown>,
  requestedClaims: string[],
): Record<string, unknown> | undefined {
  const disclosedClaims: Record<string, unknown> = {}
  for (const name of requestedClaims) {
    if (!Object.prototype.hasOwnProperty.call(claims, name)) return undefined
    disclosedClaims[name] = claims[name]
  }
  return disclosedClaims
}

function equalStrings(left: string[], right: Array<string | undefined>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
