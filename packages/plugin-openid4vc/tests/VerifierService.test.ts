import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../src/types'

import { RecordNotFoundError } from '@credo-ts/core'
import {
  OpenId4VcVerificationSessionRepository,
  OpenId4VcVerificationSessionState,
} from '@credo-ts/openid4vc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminApiErrorCode, AnonCredsTrustError, AnonCredsTrustErrorReason } from '@verana-labs/vs-agent-sdk'

import { VerifierService } from '../src/services/VerifierService'
import { trustedIssuersForPresentation } from '../src/trust/presentedIssuer'

const {
  decidePresentationTrust,
  findBoundVerificationMethodId,
  loadSigningCertificate,
  resolveCredentialType,
  verifyKeyBoundToDid,
} = vi.hoisted(() => ({
  decidePresentationTrust: vi.fn(),
  findBoundVerificationMethodId: vi.fn(),
  loadSigningCertificate: vi.fn(),
  resolveCredentialType: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
}))
vi.mock('../src/services/credentialConfigurationBuilder', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/credentialConfigurationBuilder')>()),
  resolveCredentialType,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  findBoundVerificationMethodId,
  verifyKeyBoundToDid,
}))
vi.mock('../src/trust/trustDecision', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/trustDecision')>()),
  decidePresentationTrust,
}))

const AGENT_DID = 'did:web:agent.example'
const PUBLIC_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
  y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
}

const ISSUER_DID = 'did:web:issuer.example'
const VCT = 'https://credentials.example/vt/vct/1'
const VTJSC_ID = 'https://credentials.example/vt/employee.json'
const JSON_SCHEMA = JSON.stringify({
  title: 'Employee credential',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: { name: { type: 'string' }, role: { type: 'string' } },
      required: ['name'],
    },
  },
})

const employeeType: OpenId4VcCredentialConfiguration = {
  id: VTJSC_ID,
  format: 'dc+sd-jwt',
  vct: VCT,
  name: 'Employee credential',
  vtjscId: VTJSC_ID,
  credentialSchemaId: 1,
  jsonSchema: JSON_SCHEMA,
  claims: ['name', 'role'],
  disclosureFrame: ['name', 'role'],
}

const verifierOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  verifier: {},
  credentialConfigurations: [],
})

function verifierApi() {
  return {
    getVerifierByVerifierId: vi.fn(),
    createVerifier: vi.fn(),
    updateVerifierMetadata: vi.fn(),
    createAuthorizationRequest: vi.fn(),
    getVerificationSessionById: vi.fn(),
    getVerifiedAuthorizationResponse: vi.fn(),
    findVerificationSessionsByQuery: vi.fn(),
    deleteVerificationSessionById: vi.fn(),
  }
}

const verificationSessionRepository = { update: vi.fn() }
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
const anonCredsTrust = { assertOwnAuthorization: vi.fn(), assertAuthorized: vi.fn() }
const setTrustedIssuersForVerification = vi.fn()
const resolveDidTrust = vi.fn()

function verifierAgent(
  api = verifierApi(),
  did: string | undefined = AGENT_DID,
  ecsClaims?: { service?: Record<string, string | undefined> },
) {
  return {
    did,
    ecsClaims,
    config: { logger, setTrustedIssuersForVerification },
    dids: { resolve: () => undefined },
    anonCredsTrust,
    genericRecords: {},
    kms: {},
    x509: {},
    context: {
      dependencyManager: {
        resolve: (token: unknown) =>
          token === OpenId4VcVerificationSessionRepository ? verificationSessionRepository : {},
      },
    },
    modules: { openId4Vc: { verifier: api } },
  }
}

function verifierService(agent: ReturnType<typeof verifierAgent>, options = verifierOptions()) {
  return new VerifierService(agent as never, options, resolveDidTrust)
}

const signingLeaf = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
  rawCertificate: Buffer.from('signing-leaf'),
}
const signingRoot = { subject: 'root' }

function verifierSigningHandle() {
  return {
    certificate: signingLeaf,
    chain: [signingLeaf, signingRoot],
    keyId: 'verifier-key',
    development: false,
  }
}

function verificationSession(overrides: Record<string, unknown> = {}) {
  const tags: Record<string, unknown> = {
    jsonSchemaCredentialId: VTJSC_ID,
    credentialSchemaId: '1',
    requestedClaims: ['name'],
  }
  const metadata: Record<string, unknown> = {}
  return {
    id: 'session-1',
    verifierId: 'verifier',
    state: 'RequestCreated',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: undefined,
    errorMessage: undefined,
    getTag: (name: string) => tags[name],
    setTag: (name: string, value: unknown) => {
      tags[name] = value
    },
    metadata: {
      get: (key: string) => metadata[key] ?? null,
      set: (key: string, value: unknown) => {
        metadata[key] = value
      },
    },
    ...overrides,
  }
}

function session(state = 'ResponseVerified', verifierId = 'verifier') {
  return verificationSession({
    id: 'session-id',
    verifierId,
    state,
    createdAt: new Date('2026-07-21T10:00:00.000Z'),
    expiresAt: new Date('2026-07-21T10:05:00.000Z'),
  })
}

const presentedCredential = { claimFormat: 'dc+sd-jwt', payload: { vct: VCT }, prettyClaims: { name: 'Ada' } }

const acceptedDecision = {
  cryptographicVerified: true,
  accepted: true,
  trust: {
    verdict: 'TRUSTED_AUTHORIZED',
    evidence: {
      did: ISSUER_DID,
      trustStatus: 'TRUSTED',
      jsonSchemaCredentialId: VTJSC_ID,
      authorized: true,
      queries: [],
    },
  },
  credential: { vct: VCT, disclosedClaims: { name: 'Ada' } },
}

async function initializedVerifier() {
  const api = verifierApi()
  api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })

  const service = verifierService(verifierAgent(api))
  await service.ensureInitialized()
  return { service, api }
}

describe('VerifierService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSigningCertificate.mockResolvedValue(verifierSigningHandle())
    verifyKeyBoundToDid.mockResolvedValue('bound')
    resolveCredentialType.mockResolvedValue(employeeType)
    anonCredsTrust.assertOwnAuthorization.mockResolvedValue(undefined)
  })

  it('initializes on the Nest module hook and logs the certificate mode', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = verifierService(verifierAgent(api))

    await service.onModuleInit()
    await service.onModuleInit()

    expect(loadSigningCertificate).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith('[OpenID4VC] verifier signs with a configured certificate')
  })

  it('hands credo the trusted-issuer rule of a presented credential', async () => {
    await initializedVerifier()

    expect(setTrustedIssuersForVerification).toHaveBeenCalledWith(trustedIssuersForPresentation)
  })

  it('initializes the verifier on the first certificate read', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = verifierService(verifierAgent(api))

    await expect(service.getCertificateInfo()).resolves.toMatchObject({
      role: 'verifier',
      development: false,
    })
    expect(loadSigningCertificate).toHaveBeenCalledOnce()
  })

  it('creates the configured verifier after authentication key binding succeeds', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockRejectedValue(
      new RecordNotFoundError('verifier not found', { recordType: 'OpenId4VcVerifierRecord' }),
    )
    const service = verifierService(verifierAgent(api))

    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledWith(
      expect.anything(),
      verifierOptions().verifier!.signing,
      'https://agent.example',
      'verifier',
    )
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(expect.anything(), AGENT_DID, PUBLIC_JWK, [
      'authentication',
    ])
    expect(api.createVerifier).toHaveBeenCalledWith({ verifierId: 'verifier' })
    expect(api.updateVerifierMetadata).not.toHaveBeenCalled()
  })

  it('updates an existing verifier and caches concurrent initialization', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = verifierService(verifierAgent(api))

    await Promise.all([service.ensureInitialized(), service.ensureInitialized(), service.ensureInitialized()])

    expect(loadSigningCertificate).toHaveBeenCalledOnce()
    expect(verifyKeyBoundToDid).toHaveBeenCalledOnce()
    expect(api.getVerifierByVerifierId).toHaveBeenCalledOnce()
    expect(api.updateVerifierMetadata).toHaveBeenCalledWith({ verifierId: 'verifier' })
    expect(api.createVerifier).not.toHaveBeenCalled()
  })

  it('retries initialization after a failed first attempt', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = verifierService(verifierAgent(api))
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
  })

  it('requires an agent DID before loading verifier signing material', async () => {
    const service = verifierService({ ...verifierAgent(), did: undefined } as never)

    await expect(service.ensureInitialized()).rejects.toThrow('agent DID')
    expect(loadSigningCertificate).not.toHaveBeenCalled()
  })

  it('rejects a verifier certificate DID that differs from the agent DID', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...verifierSigningHandle(),
      certificate: { ...signingLeaf, sanUriNames: ['did:example:attacker'] },
    })
    const service = verifierService(verifierAgent())

    await expect(service.ensureInitialized()).rejects.toThrow('does not match the agent DID')
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
  })

  it.each([
    ['unresolvable', 'could not be resolved'],
    ['unbound', 'authentication'],
  ] as const)('fails initialization for %s authentication key binding', async (binding, message) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const service = verifierService(verifierAgent())

    await expect(service.ensureInitialized()).rejects.toThrow(message)
  })

  it('creates a direct_post.jwt DCQL request for exactly the requested claims', async () => {
    const { service, api } = await initializedVerifier()
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })

    await expect(
      service.createRequest({ jsonSchemaCredentialId: VTJSC_ID, requestedClaims: ['name'] }),
    ).resolves.toEqual({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSessionId: 'session-id',
    })
    expect(resolveCredentialType).toHaveBeenCalledWith(expect.anything(), VTJSC_ID)
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
              id: 'cs-1',
              format: 'dc+sd-jwt',
              meta: { vct_values: [VCT] },
              claims: [{ path: ['name'] }],
            },
          ],
        },
      },
    })
  })

  it('requires an active VERIFIER Participant of the agent for the schema of the type', async () => {
    const { service, api } = await initializedVerifier()
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })

    await service.createRequest({ jsonSchemaCredentialId: VTJSC_ID })

    expect(anonCredsTrust.assertOwnAuthorization).toHaveBeenCalledWith({
      role: 'VERIFIER',
      credentialSchemaId: 1,
    })
  })

  it('honours an explicit per-request x5c signer', async () => {
    const { service, api } = await initializedVerifier()
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })

    await service.createRequest({
      jsonSchemaCredentialId: VTJSC_ID,
      requestedClaims: ['name'],
      queryLanguage: 'dcql',
      requestSigner: 'x5c',
    })

    expect(api.createAuthorizationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSigner: {
          method: 'x5c',
          x5c: [signingLeaf, signingRoot],
          clientIdPrefix: 'x509_hash',
        },
      }),
    )
  })

  it('answers UNKNOWN_ID for a VTJSC that binds to no CredentialSchema', async () => {
    const { service, api } = await initializedVerifier()
    resolveCredentialType.mockRejectedValue(
      new AnonCredsTrustError(AnonCredsTrustErrorReason.NotDerivable, 'the VTJSC "unknown" binds to none'),
    )

    await expect(service.createRequest({ jsonSchemaCredentialId: 'unknown' })).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
      status: 404,
      message: 'the VTJSC "unknown" binds to none',
    })
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('answers NOT_AUTHORIZED without an active VERIFIER Participant', async () => {
    const { service, api } = await initializedVerifier()
    anonCredsTrust.assertOwnAuthorization.mockRejectedValue(
      new AnonCredsTrustError(AnonCredsTrustErrorReason.NotAuthorized, 'no active VERIFIER Participant'),
    )

    await expect(service.createRequest({ jsonSchemaCredentialId: VTJSC_ID })).rejects.toMatchObject({
      code: AdminApiErrorCode.NotAuthorized,
      status: 409,
    })
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('answers RESOLVER_UNAVAILABLE when the Participant check cannot run', async () => {
    const { service, api } = await initializedVerifier()
    anonCredsTrust.assertOwnAuthorization.mockRejectedValue(
      new AnonCredsTrustError(AnonCredsTrustErrorReason.Unavailable, 'the indexer did not answer'),
    )

    await expect(service.createRequest({ jsonSchemaCredentialId: VTJSC_ID })).rejects.toMatchObject({
      code: AdminApiErrorCode.ResolverUnavailable,
      status: 503,
    })
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('requests every claim of the type when the caller names none', async () => {
    const { service, api } = await initializedVerifier()
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })

    await service.createRequest({ jsonSchemaCredentialId: VTJSC_ID })

    expect(api.createAuthorizationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        dcql: {
          query: {
            credentials: [
              {
                id: 'cs-1',
                format: 'dc+sd-jwt',
                meta: { vct_values: [VCT] },
                claims: [{ path: ['name'] }, { path: ['role'] }],
              },
            ],
          },
        },
      }),
    )
  })

  it.each([
    [['name', 'name'], 'duplicate'],
    [['name', 'admin'], "unknown claim 'admin'"],
  ])('rejects requestedClaims %j without creating a request', async (requestedClaims, message) => {
    const { service, api } = await initializedVerifier()

    await expect(
      service.createRequest({ jsonSchemaCredentialId: VTJSC_ID, requestedClaims }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidInput })
    await expect(
      service.createRequest({ jsonSchemaCredentialId: VTJSC_ID, requestedClaims }),
    ).rejects.toThrow(message)
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('returns only unverified state fields before Credo reaches ResponseVerified', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('RequestUriRetrieved'))
    const service = verifierService(verifierAgent(api))

    await expect(service.getVerificationSession('session-id')).resolves.toEqual({
      id: 'session-id',
      jsonSchemaCredentialId: VTJSC_ID,
      requestedClaims: ['name'],
      state: 'RequestUriRetrieved',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T10:00:00.000Z'),
      cryptographicVerified: false,
      accepted: false,
    })
    expect(decidePresentationTrust).not.toHaveBeenCalled()
  })

  it('maps missing sessions to a typed error', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockRejectedValue(
      new RecordNotFoundError('not found', { recordType: 'OpenId4VcVerificationSessionRecord' }),
    )
    const service = verifierService(verifierAgent(api))

    await expect(service.getVerificationSession('missing')).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
  })

  it('rejects sessions owned by another configured verifier', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('ResponseVerified', 'other-verifier'))
    const service = verifierService(verifierAgent(api))

    await expect(service.getVerificationSession('session-id')).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
  })

  describe('verification sessions', () => {
    it('stores the type, its schema and the requested claims on the session it creates', async () => {
      const { service, api } = await initializedVerifier()
      const tags: Record<string, unknown> = {}
      const session = verificationSession({
        getTag: (name: string) => tags[name],
        setTag: (name: string, value: unknown) => {
          tags[name] = value
        },
      })
      api.createAuthorizationRequest.mockResolvedValue({
        authorizationRequest: 'openid4vp://request',
        verificationSession: session,
      })

      await service.createRequest({ jsonSchemaCredentialId: VTJSC_ID, requestedClaims: ['name'] })

      expect(tags).toEqual({
        jsonSchemaCredentialId: VTJSC_ID,
        credentialSchemaId: '1',
        requestedClaims: ['name'],
      })
      expect(verificationSessionRepository.update).toHaveBeenCalledWith(expect.anything(), session)
    })

    it('summarizes a pending session with its request and no trust block', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValue(verificationSession())

      await expect(service.getVerificationSession('session-1')).resolves.toEqual({
        id: 'session-1',
        jsonSchemaCredentialId: VTJSC_ID,
        requestedClaims: ['name'],
        state: 'RequestCreated',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        cryptographicVerified: false,
        accepted: false,
      })
    })

    it('decides a verified session on its first read and stores the verdict with it', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      api.getVerificationSessionById.mockResolvedValue(session)
      api.getVerifiedAuthorizationResponse.mockResolvedValue({
        dcql: { presentations: { [VTJSC_ID]: [presentedCredential] } },
      })
      decidePresentationTrust.mockResolvedValue(acceptedDecision)

      await expect(service.getVerificationSession('session-1')).resolves.toMatchObject({
        state: 'ResponseVerified',
        ...acceptedDecision,
      })

      expect(decidePresentationTrust).toHaveBeenCalledWith(
        presentedCredential,
        { jsonSchemaCredentialId: VTJSC_ID, credentialSchemaId: 1 },
        expect.objectContaining({ resolveDidTrust }),
      )
      expect(session.metadata.get('openid4vc/verificationOutcome')).toEqual(acceptedDecision)
      expect(verificationSessionRepository.update).toHaveBeenCalledWith(expect.anything(), session)
    })

    it('decides a Presentation Exchange session from its presentations', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValue(verificationSession({ state: 'ResponseVerified' }))
      api.getVerifiedAuthorizationResponse.mockResolvedValue({
        presentationExchange: { presentations: [presentedCredential] },
      })
      decidePresentationTrust.mockResolvedValue(acceptedDecision)

      await service.getVerificationSession('session-1')

      expect(decidePresentationTrust).toHaveBeenCalledWith(
        presentedCredential,
        expect.anything(),
        expect.anything(),
      )
    })

    it('returns the stored decision of a verified session without deciding again', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      session.metadata.set('openid4vc/verificationOutcome', acceptedDecision)
      api.getVerificationSessionById.mockResolvedValue(session)

      await expect(service.getVerificationSession('session-1')).resolves.toMatchObject({
        state: 'ResponseVerified',
        ...acceptedDecision,
      })
      expect(decidePresentationTrust).not.toHaveBeenCalled()
      expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
    })

    it('stores nothing when the verdict is RESOLVER_UNAVAILABLE, so the next read retries', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      api.getVerificationSessionById.mockResolvedValue(session)
      api.getVerifiedAuthorizationResponse.mockResolvedValue({
        dcql: { presentations: { [VTJSC_ID]: [presentedCredential] } },
      })
      decidePresentationTrust.mockResolvedValue({
        ...acceptedDecision,
        accepted: false,
        trust: { ...acceptedDecision.trust, verdict: 'RESOLVER_UNAVAILABLE' },
      })

      const summary = await service.getVerificationSession('session-1')

      expect(summary.trust?.verdict).toBe('RESOLVER_UNAVAILABLE')
      expect(session.metadata.get('openid4vc/verificationOutcome')).toBeNull()
      expect(verificationSessionRepository.update).not.toHaveBeenCalled()
    })

    it('lists only the sessions of this verifier and leaves the filters to the query', async () => {
      const { service, api } = await initializedVerifier()
      api.findVerificationSessionsByQuery.mockResolvedValue([
        verificationSession(),
        verificationSession({ id: 'session-2' }),
      ])

      const sessions = await service.listVerificationSessions()

      expect(api.findVerificationSessionsByQuery).toHaveBeenCalledWith({ verifierId: 'verifier' })

      await service.listVerificationSessions({
        jsonSchemaCredentialId: 'badge',
        state: OpenId4VcVerificationSessionState.ResponseVerified,
      })

      expect(api.findVerificationSessionsByQuery).toHaveBeenLastCalledWith({
        verifierId: 'verifier',
        jsonSchemaCredentialId: 'badge',
        state: 'ResponseVerified',
      })
      expect(sessions.map(session => session.id)).toEqual(['session-1', 'session-2'])
    })

    it('lists a verified session nobody read yet as verified but not accepted', async () => {
      const { service, api } = await initializedVerifier()
      api.findVerificationSessionsByQuery.mockResolvedValue([
        verificationSession({ state: 'ResponseVerified' }),
      ])

      const sessions = await service.listVerificationSessions()

      expect(sessions).toEqual([
        {
          id: 'session-1',
          jsonSchemaCredentialId: VTJSC_ID,
          requestedClaims: ['name'],
          state: 'ResponseVerified',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          cryptographicVerified: true,
          accepted: false,
        },
      ])
      expect(decidePresentationTrust).not.toHaveBeenCalled()
      expect(verificationSessionRepository.update).not.toHaveBeenCalled()
    })

    it('lists a verified session from its stored decision', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      session.metadata.set('openid4vc/verificationOutcome', acceptedDecision)
      api.findVerificationSessionsByQuery.mockResolvedValue([session])

      const sessions = await service.listVerificationSessions()

      expect(sessions[0]).toMatchObject(acceptedDecision)
    })

    it('deletes a session of this verifier', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValueOnce(verificationSession())

      await service.deleteVerificationSession('session-1')

      expect(api.deleteVerificationSessionById).toHaveBeenCalledWith('session-1')
    })

    it('refuses to delete a session of another verifier', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValueOnce(verificationSession({ verifierId: 'other' }))

      await expect(service.deleteVerificationSession('session-1')).rejects.toMatchObject({
        code: AdminApiErrorCode.UnknownId,
      })
      expect(api.deleteVerificationSessionById).not.toHaveBeenCalled()
    })
  })

  describe('DID request signer', () => {
    it('signs a DCQL request with the DID on a per-request did override', async () => {
      findBoundVerificationMethodId.mockResolvedValue(`${AGENT_DID}#openid4vc-verifier`)
      const { service, api } = await initializedVerifier()
      api.createAuthorizationRequest.mockResolvedValue({
        authorizationRequest: 'openid4vp://r',
        verificationSession: verificationSession(),
      })

      await service.createRequest({
        jsonSchemaCredentialId: VTJSC_ID,
        requestedClaims: ['name'],
        queryLanguage: 'dcql',
        requestSigner: 'did',
      })

      expect(api.createAuthorizationRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestSigner: { method: 'did', didUrl: `${AGENT_DID}#openid4vc-verifier` },
        }),
      )
    })

    it('fails a did-signed request when the DID does not publish the signing key', async () => {
      findBoundVerificationMethodId.mockResolvedValue(null)
      const { service } = await initializedVerifier()
      await expect(
        service.createRequest({
          jsonSchemaCredentialId: VTJSC_ID,
          requestedClaims: ['name'],
          queryLanguage: 'dcql',
          requestSigner: 'did',
        }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidState })
    })
  })

  describe('ECS service display', () => {
    it('publishes the ECS Service name and logo in the client metadata', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
      const ecsClaims = { service: { name: 'Verana Demo', logoUri: 'https://agent.example/logo.svg' } }

      await verifierService(verifierAgent(api, AGENT_DID, ecsClaims)).ensureInitialized()

      expect(api.updateVerifierMetadata).toHaveBeenCalledWith({
        verifierId: 'verifier',
        clientMetadata: { client_name: 'Verana Demo', logo_uri: 'https://agent.example/logo.svg' },
      })
    })

    it('publishes no client metadata at all without an ECS Service claim', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })

      await verifierService(verifierAgent(api, AGENT_DID, { service: {} })).ensureInitialized()

      expect(api.updateVerifierMetadata).toHaveBeenCalledWith({ verifierId: 'verifier' })
    })

    it('omits the logo when the ECS Service claim carries no logo URI', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })

      await verifierService(
        verifierAgent(api, AGENT_DID, { service: { name: 'Verana Demo' } }),
      ).ensureInitialized()

      expect(api.updateVerifierMetadata).toHaveBeenCalledWith({
        verifierId: 'verifier',
        clientMetadata: { client_name: 'Verana Demo' },
      })
    })
  })
})
