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
import {
  blockingBindingVerdict,
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
} from './CertificateService'

// What the issuer signs with (IssuerService credential_signing_alg_values_supported).
const PRESENTATION_ALGORITHMS = ['ES256'] as const

type VerifierApi = Pick<
  OpenId4VcVerifierApi,
  | 'getVerifierByVerifierId'
  | 'createVerifier'
  | 'updateVerifierMetadata'
  | 'createAuthorizationRequest'
  | 'getVerificationSessionById'
  | 'getVerifiedAuthorizationResponse'
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

/**
 * Which query language the authorization request carries. DCQL is the OpenID4VP v1 default;
 * `presentation_exchange` exists for wallets that never implemented DCQL and reject a v1 request.
 */
export type OpenId4VcQueryLanguage = 'dcql' | 'presentation_exchange'

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
    // A rejected initialization must not be cached: a transient boot-time
    // failure (KMS or storage not ready yet) would otherwise wedge the
    // process until restart. Reset so the next call retries.
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
      throw new OpenId4VcVerifierRequestError(`unknown verifier policy '${policyId}'`)
    }
    const configuration = findCredentialConfiguration(this.options, policy.credentialConfigurationId)
    if (!configuration) {
      throw new OpenId4VcVerifierRequestError(
        `verifier policy '${policyId}' references an unknown credential configuration`,
      )
    }

    // OpenID4VP v1 replaced Presentation Exchange with DCQL and forbids the two together, so a
    // presentation_definition request has to be minted on the last draft that still admits it.
    // Wallets predating DCQL reject a v1 request outright rather than degrade.
    const query =
      queryLanguage === 'presentation_exchange'
        ? {
            version: 'v1.draft21' as const,
            presentationExchange: { definition: presentationDefinitionFor(configuration, policy) },
          }
        : {
            dcql: {
              query: {
                credentials: [
                  {
                    id: configuration.id,
                    format: 'dc+sd-jwt' as const,
                    meta: { vct_values: [configuration.vct] },
                    claims: policy.requestedClaims.map(name => ({ path: [name] })),
                  },
                ],
              },
            },
          }

    const { authorizationRequest, verificationSession } = await this.verifierApi().createAuthorizationRequest(
      {
        verifierId: this.verifierOptions().id,
        requestSigner: await this.buildRequestSigner(queryLanguage, requestSigner),
        // JARM only on the DCQL rail. Credo hardcodes a P-256 encryption key, and the wallets
        // that need Presentation Exchange either have no JWE at all or can only wrap to an
        // X25519 one, so an encrypted response is unconstructable for them and the share fails
        // after the user consents. The response still travels to the verifier over TLS.
        responseMode: queryLanguage === 'presentation_exchange' ? 'direct_post' : 'direct_post.jwt',
        ...query,
      },
    )

    return {
      authorizationRequest,
      verificationSessionId: verificationSession.id,
    }
  }

  /** Public signing-certificate material, for operators wiring verifier
   *  fingerprint pins (never includes private keys). */
  public getCertificateInfo(): SigningCertificateInfo {
    return signingCertificateInfo('verifier', this.signingCertificateHandle())
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

    // Presentation Exchange returns a flat array rather than a map keyed by query id; the policy
    // match above already established there is exactly one descriptor, so index 0 is that one.
    const presentation =
      verified.dcql?.presentations[configuration.id]?.[0] ?? verified.presentationExchange?.presentations[0]
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
    if (verified.presentationExchange) {
      return this.matchPresentationExchangePolicy(verified.presentationExchange.definition)
    }

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

  /** Same acceptance rules as the DCQL path, read off the definition we minted. */
  private matchPresentationExchangePolicy(
    definition: unknown,
  ): { policy: OpenId4VcVerifierPolicy } | undefined {
    if (!isRecord(definition) || !Array.isArray(definition.input_descriptors)) return undefined
    if (definition.input_descriptors.length !== 1) return undefined

    const descriptor: unknown = definition.input_descriptors[0]
    if (!isRecord(descriptor) || typeof descriptor.id !== 'string') return undefined

    const configuration = findCredentialConfiguration(this.options, descriptor.id)
    if (!configuration) return undefined

    if (!isRecord(descriptor.constraints) || !Array.isArray(descriptor.constraints.fields)) return undefined

    let vctMatched = false
    const requestedClaims: string[] = []
    for (const field of descriptor.constraints.fields) {
      if (!isRecord(field) || !Array.isArray(field.path) || field.path.length !== 1) return undefined
      const path = field.path[0]
      if (typeof path !== 'string' || !path.startsWith('$.')) return undefined
      const name = path.slice(2)

      if (name === 'vct') {
        const filter = field.filter
        if (!isRecord(filter) || filter.const !== configuration.vct) return undefined
        vctMatched = true
        continue
      }
      requestedClaims.push(name)
    }
    if (!vctMatched) return undefined

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

  private async buildRequestSigner(queryLanguage: OpenId4VcQueryLanguage, override?: 'x5c' | 'did') {
    const certificate = this.signingCertificateHandle()
    if ((override ?? this.verifierOptions().requestSigner) !== 'did') {
      return { method: 'x5c' as const, x5c: certificate.chain, clientIdPrefix: 'x509_hash' as const }
    }

    const did = this.agent.did ?? null

    // Presentation Exchange is the rail for wallets predating DCQL, and those wallets tend to
    // verify the request with an EdDSA-only implementation that resolves did:web but not
    // did:webvh. Sign that rail with the Ed25519 authentication key, named by the parallel
    // did:web the agent already publishes, so such a wallet can fetch the key and check the
    // signature. DCQL keeps the certificate-bound key and the did:webvh identifier, so the
    // wallets already verified against it are untouched.
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

/**
 * The Presentation Exchange equivalent of the DCQL query above: one input descriptor pinned to the
 * configuration's vct, disclosing exactly the claims the policy asks for. `limit_disclosure` keeps
 * the selective-disclosure guarantee DCQL gives implicitly.
 *
 * `format` mirrors what the DCQL branch declares, so a wallet can see which proof types are
 * accepted: some read its absence as "matches nothing" and report no matching credential without
 * ever showing the request. It says `vc+sd-jwt` even though we issue `dc+sd-jwt`, because the
 * Presentation Exchange schema admits no `dc+sd-jwt` key and PEX rejects the definition outright.
 */
function escapeForFilterPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function presentationDefinitionFor(
  configuration: { id: string; vct: string },
  policy: { requestedClaims: string[] },
) {
  return {
    id: `${configuration.id}-presentation-exchange`,
    format: {
      'vc+sd-jwt': {
        'sd-jwt_alg_values': [...PRESENTATION_ALGORITHMS],
        'kb-jwt_alg_values': [...PRESENTATION_ALGORITHMS],
      },
    },
    input_descriptors: [
      {
        id: configuration.id,
        constraints: {
          // 'preferred', not 'required': MOSIP rejects any other value, and the verifier
          // already fails closed when a requested claim is missing from the response.
          limit_disclosure: 'preferred' as const,
          fields: [
            {
              path: ['$.vct'],
              // `pattern` next to `const`: MOSIP's Presentation Exchange parser requires
              // filter.pattern and knows no other filter key, while wallets reading the
              // credential type back out of the definition follow `const`.
              filter: {
                type: 'string' as const,
                const: configuration.vct,
                pattern: escapeForFilterPattern(configuration.vct),
              },
            },
            ...policy.requestedClaims.map(name => ({ path: [`$.${name}`] })),
          ],
        },
      },
    ],
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
    if (!Object.hasOwn(claims, name)) return undefined
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
