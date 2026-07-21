import type { OpenId4VcPluginOptions } from '../src/types'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  OpenId4VcVerifierRequestError,
  UnknownVerificationSessionError,
  VerifierService,
} from '../src/services/VerifierService'

const { loadSigningCertificate, verifyKeyBoundToDid, verdictFor } = vi.hoisted(() => ({
  loadSigningCertificate: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
  verdictFor: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  verifyKeyBoundToDid,
}))
vi.mock('../src/trust/TrustClient', () => ({
  TrustClient: class {
    public verdictFor = verdictFor
  },
}))

const AGENT_DID = 'did:example:verifier'
const ISSUER_DID = 'did:web:issuer.example'
const VCT = 'https://agent.example/oid4vc/vct/employee'
const VTJSC_ID = 'https://agent.example/vt/employee.json'
const PUBLIC_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
  y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
}

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  verifier: {
    id: 'verifier',
    displayName: 'Example Verifier',
    signing: { development: { enabled: true, commonName: 'Example Verifier' } },
  },
  trust: {
    resolverUrl: 'https://resolver.example/v1/trust',
    timeoutMs: 5_000,
    credentialIssuerCertificates: ['trusted-root'],
  },
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: VCT,
      name: 'Employee credential',
      vtjscId: VTJSC_ID,
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
      ttlSeconds: 3_600,
    },
  ],
  verifierPolicies: [
    {
      id: 'employee-name',
      credentialConfigurationId: 'employee',
      requestedClaims: ['name'],
    },
  ],
})

function verifierApi() {
  return {
    getVerifierByVerifierId: vi.fn(),
    createVerifier: vi.fn(),
    updateVerifierMetadata: vi.fn(),
    createAuthorizationRequest: vi.fn(),
    getVerificationSessionById: vi.fn(),
    getVerifiedAuthorizationResponse: vi.fn(),
  }
}

function agent(api = verifierApi(), did: string | undefined = AGENT_DID) {
  return {
    did,
    dids: { resolve: vi.fn() },
    genericRecords: {},
    kms: {},
    x509: {},
    modules: { openId4Vc: { verifier: api } },
  }
}

const signingLeaf = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
}
const signingRoot = { subject: 'root' }
const issuerLeaf = {
  sanUriNames: [ISSUER_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
}

function signingHandle() {
  return {
    certificate: signingLeaf,
    chain: [signingLeaf, signingRoot],
    keyId: 'verifier-key',
    development: false,
  }
}

function session(state = 'ResponseVerified', verifierId = 'verifier') {
  return {
    id: 'session-id',
    verifierId,
    state,
    createdAt: new Date('2026-07-21T10:00:00.000Z'),
    expiresAt: new Date('2026-07-21T10:05:00.000Z'),
  }
}

function presentation(overrides: Record<string, unknown> = {}) {
  return {
    claimFormat: ClaimFormat.SdJwtDc,
    encoded: 'secret-encoded-credential',
    compact: 'secret-compact-credential',
    header: { x5c: ['secret-certificate'] },
    issuer: { method: 'x5c', x5c: [issuerLeaf] },
    payload: { vct: VCT, name: 'Ada' },
    prettyClaims: { vct: VCT, name: 'Ada', admin: true },
    ...overrides,
  }
}

function verifiedResponse(presented: unknown[] = [presentation()], responseSession = session()) {
  return {
    verificationSession: responseSession,
    dcql: {
      query: {
        credentials: [
          {
            id: 'employee',
            format: 'dc+sd-jwt',
            meta: { vct_values: [VCT] },
            claims: [{ path: ['name'] }],
          },
        ],
      },
      presentations: { employee: presented },
      presentationResult: {},
    },
  }
}

function trust(verdict: 'TRUSTED_AUTHORIZED' | 'TRUSTED_NOT_AUTHORIZED' | 'RESOLVER_UNAVAILABLE') {
  return {
    verdict,
    evidence: {
      did: ISSUER_DID,
      trustStatus: verdict === 'RESOLVER_UNAVAILABLE' ? null : 'TRUSTED',
      vtjscId: VTJSC_ID,
      authorized:
        verdict === 'TRUSTED_AUTHORIZED' ? true : verdict === 'TRUSTED_NOT_AUTHORIZED' ? false : null,
      queries: ['https://resolver.example/safe-evidence'],
    },
  }
}

describe('VerifierService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSigningCertificate.mockResolvedValue(signingHandle())
    verifyKeyBoundToDid.mockResolvedValue('bound')
    verdictFor.mockResolvedValue(trust('TRUSTED_AUTHORIZED'))
  })

  it('creates the configured verifier after authentication key binding succeeds', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockRejectedValue(
      new RecordNotFoundError('verifier not found', { recordType: 'OpenId4VcVerifierRecord' }),
    )
    const service = new VerifierService(agent(api) as never, options())

    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledOnce()
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(expect.anything(), AGENT_DID, PUBLIC_JWK, [
      'authentication',
    ])
    expect(api.createVerifier).toHaveBeenCalledWith({
      verifierId: 'verifier',
      clientMetadata: { client_name: 'Example Verifier' },
    })
    expect(api.updateVerifierMetadata).not.toHaveBeenCalled()
  })

  it('updates an existing verifier and caches concurrent initialization', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = new VerifierService(agent(api) as never, options())

    await Promise.all([service.ensureInitialized(), service.ensureInitialized(), service.ensureInitialized()])

    expect(loadSigningCertificate).toHaveBeenCalledOnce()
    expect(verifyKeyBoundToDid).toHaveBeenCalledOnce()
    expect(api.getVerifierByVerifierId).toHaveBeenCalledOnce()
    expect(api.updateVerifierMetadata).toHaveBeenCalledWith({
      verifierId: 'verifier',
      clientMetadata: { client_name: 'Example Verifier' },
    })
    expect(api.createVerifier).not.toHaveBeenCalled()
  })

  it('requires an agent DID before loading verifier signing material', async () => {
    const agentWithoutDid = agent()
    delete agentWithoutDid.did
    const service = new VerifierService(agentWithoutDid as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow('agent DID')
    expect(loadSigningCertificate).not.toHaveBeenCalled()
  })

  it('rejects a verifier certificate DID that differs from the agent DID', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...signingHandle(),
      certificate: { ...signingLeaf, sanUriNames: ['did:example:attacker'] },
    })
    const service = new VerifierService(agent() as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow('does not match the agent DID')
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
  })

  it.each([
    ['unresolvable', 'could not be resolved'],
    ['unbound', 'authentication'],
  ] as const)('fails initialization for %s authentication key binding', async (binding, message) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const service = new VerifierService(agent() as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow(message)
  })

  it('creates a direct_post.jwt DCQL request for exactly the selected policy', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })
    const service = new VerifierService(agent(api) as never, options())
    await service.ensureInitialized()

    await expect(service.createRequest('employee-name')).resolves.toEqual({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSessionId: 'session-id',
    })
    expect(api.createAuthorizationRequest).toHaveBeenCalledWith({
      verifierId: 'verifier',
      requestSigner: {
        method: 'x5c',
        x5c: [signingLeaf, signingRoot],
        clientIdPrefix: 'x509_hash',
      },
      responseMode: 'direct_post.jwt',
      dcql: {
        query: {
          credentials: [
            {
              id: 'employee',
              format: 'dc+sd-jwt',
              meta: { vct_values: [VCT] },
              claims: [{ path: ['name'] }],
            },
          ],
        },
      },
    })
  })

  it('fails unknown policies clearly without creating a request', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = new VerifierService(agent(api) as never, options())
    await service.ensureInitialized()

    await expect(service.createRequest('unknown')).rejects.toBeInstanceOf(OpenId4VcVerifierRequestError)
    await expect(service.createRequest('unknown')).rejects.toThrow("unknown verifier policy 'unknown'")
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('returns only unverified state fields before Credo reaches ResponseVerified', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('RequestUriRetrieved'))
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).resolves.toEqual({
      state: 'RequestUriRetrieved',
      cryptographicVerified: false,
      accepted: false,
    })
    expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
    expect(verdictFor).not.toHaveBeenCalled()
  })

  it('maps missing sessions to a typed error', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockRejectedValue(
      new RecordNotFoundError('not found', { recordType: 'OpenId4VcVerificationSessionRecord' }),
    )
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('missing')).rejects.toBeInstanceOf(UnknownVerificationSessionError)
    expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
  })

  it('rejects sessions owned by another configured verifier', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('ResponseVerified', 'other-verifier'))
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).rejects.toBeInstanceOf(UnknownVerificationSessionError)
    expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
  })

  it('maps a session removed between state and verified-response reads to the typed error', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockRejectedValue(
      new RecordNotFoundError('not found', { recordType: 'OpenId4VcVerificationSessionRecord' }),
    )
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).rejects.toBeInstanceOf(UnknownVerificationSessionError)
    expect(verdictFor).not.toHaveBeenCalled()
  })

  it('accepts only a Credo-verified, key-bound, exactly authorized SD-JWT presentation', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(verifiedResponse())
    const service = new VerifierService(agent(api) as never, options())

    const result = await service.getResult('session-id')

    expect(result).toEqual({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: true,
      trust: trust('TRUSTED_AUTHORIZED'),
      credential: { vct: VCT, disclosedClaims: { name: 'Ada' } },
    })
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(expect.anything(), ISSUER_DID, PUBLIC_JWK, [
      'assertionMethod',
    ])
    expect(verdictFor).toHaveBeenCalledWith('issuer', ISSUER_DID, VTJSC_ID)
    expect(JSON.stringify(result)).not.toContain('secret-')
    expect(JSON.stringify(result)).not.toContain('admin')
  })

  it.each([
    ['TRUSTED_NOT_AUTHORIZED', false],
    ['RESOLVER_UNAVAILABLE', false],
  ] as const)('fails closed for %s trust verdicts', async (verdict, accepted) => {
    verdictFor.mockResolvedValue(trust(verdict))
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(verifiedResponse())
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).resolves.toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted,
      trust: { verdict },
    })
  })

  it.each([
    ['unbound', 'UNTRUSTED'],
    ['unresolvable', 'RESOLVER_UNAVAILABLE'],
  ] as const)('blocks %s issuer key binding before any Verana query', async (binding, verdict) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(verifiedResponse())
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).resolves.toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict, evidence: { queries: [] } },
    })
    expect(verdictFor).not.toHaveBeenCalled()
  })

  it.each([
    ['missing presentation', verifiedResponse([])],
    ['wrong credential format', verifiedResponse([presentation({ claimFormat: 'jwt_vc_json' })])],
    ['missing x5c', verifiedResponse([presentation({ issuer: { method: 'did', didUrl: ISSUER_DID } })])],
    [
      'missing DID URI SAN',
      verifiedResponse([
        presentation({ issuer: { method: 'x5c', x5c: [{ ...issuerLeaf, sanUriNames: [] }] } }),
      ]),
    ],
    [
      'wrong VCT',
      verifiedResponse([
        presentation({ prettyClaims: { vct: 'https://attacker.example/vct', name: 'Ada' } }),
      ]),
    ],
    ['missing requested claim', verifiedResponse([presentation({ prettyClaims: { vct: VCT } })])],
  ])('fails closed for a %s without resolver queries', async (_case, response) => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(response)
    const service = new VerifierService(agent(api) as never, options())

    const result = await service.getResult('session-id')

    expect(result).toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict: 'UNTRUSTED', evidence: { queries: [] } },
    })
    expect(verdictFor).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret-')
  })

  it('uses only the first presentation for the configured credential id', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(
      verifiedResponse([
        presentation({ prettyClaims: { vct: VCT, name: 'First' } }),
        presentation({ prettyClaims: { vct: VCT, name: 'Second' } }),
      ]),
    )
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).resolves.toMatchObject({
      credential: { disclosedClaims: { name: 'First' } },
    })
  })

  it('fails closed when the verified response no longer matches the session or configured policy', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse
      .mockResolvedValueOnce(verifiedResponse([presentation()], session('RequestUriRetrieved')))
      .mockResolvedValueOnce({
        ...verifiedResponse(),
        dcql: {
          ...verifiedResponse().dcql,
          query: {
            credentials: [
              {
                id: 'attacker-credential',
                format: 'dc+sd-jwt',
                meta: { vct_values: [VCT] },
                claims: [{ path: ['name'] }],
              },
            ],
          },
        },
      })
    const service = new VerifierService(agent(api) as never, options())

    await expect(service.getResult('session-id')).rejects.toThrow('changed while reading')
    await expect(service.getResult('session-id')).resolves.toMatchObject({
      accepted: false,
      trust: { verdict: 'UNTRUSTED', evidence: { queries: [] } },
    })
    expect(verdictFor).not.toHaveBeenCalled()
  })
})
