import type { OpenId4VcPluginOptions } from '../src/types'

import { RecordNotFoundError } from '@credo-ts/core'
import {
  OpenId4VcVerificationSessionRepository,
  OpenId4VcVerificationSessionState,
} from '@credo-ts/openid4vc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenId4VcErrorCode } from '../src/errors'
import { VerifierService } from '../src/services/VerifierService'

const { findBoundVerificationMethodId, loadSigningCertificate, verifyKeyBoundToDid } = vi.hoisted(() => ({
  findBoundVerificationMethodId: vi.fn(),
  loadSigningCertificate: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  findBoundVerificationMethodId,
  verifyKeyBoundToDid,
}))

const AGENT_DID = 'did:web:agent.example'
const PUBLIC_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
  y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
}

const ISSUER_DID = 'did:web:issuer.example'
const VCT = 'https://agent.example/oid4vc/vct/employee'
const VTJSC_ID = 'https://agent.example/vt/employee.json'

const verifierOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  verifier: {},
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: VCT,
      name: 'Employee credential',
      vtjscId: VTJSC_ID,
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
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
    findVerificationSessionsByQuery: vi.fn(),
    deleteVerificationSessionById: vi.fn(),
  }
}

const verificationSessionRepository = { update: vi.fn() }

function verifierAgent(
  api = verifierApi(),
  did: string | undefined = AGENT_DID,
  ecsClaims?: { service?: Record<string, string | undefined> },
) {
  return {
    did,
    ecsClaims,
    dids: { resolve: () => undefined },
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

const signingLeaf = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
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
  const tags: Record<string, unknown> = { jsonSchemaCredentialId: 'employee', requestedClaims: ['name'] }
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

async function initializedVerifier() {
  const api = verifierApi()
  api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })

  const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
  await service.ensureInitialized()
  return { service, api }
}

describe('VerifierService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSigningCertificate.mockResolvedValue(verifierSigningHandle())
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  it('creates the configured verifier after authentication key binding succeeds', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockRejectedValue(
      new RecordNotFoundError('verifier not found', { recordType: 'OpenId4VcVerifierRecord' }),
    )
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledWith(
      expect.anything(),
      verifierOptions().verifier!.signing,
      'https://agent.example',
      'verifier',
    )
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(
      expect.anything(),
      AGENT_DID,
      PUBLIC_JWK,
      ['authentication'],
      { allowedWebHosts: ['agent.example'], timeoutMs: 5_000, allowNonPublicHosts: true },
    )
    expect(api.createVerifier).toHaveBeenCalledWith({ verifierId: 'verifier' })
    expect(api.updateVerifierMetadata).not.toHaveBeenCalled()
  })

  it('updates an existing verifier and caches concurrent initialization', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

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
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
  })

  it('requires an agent DID before loading verifier signing material', async () => {
    const agentWithoutDid = { ...verifierAgent(), did: undefined }
    const service = new VerifierService(agentWithoutDid as never, verifierOptions())

    await expect(service.ensureInitialized()).rejects.toThrow('agent DID')
    expect(loadSigningCertificate).not.toHaveBeenCalled()
  })

  it('rejects a verifier certificate DID that differs from the agent DID', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...verifierSigningHandle(),
      certificate: { ...signingLeaf, sanUriNames: ['did:example:attacker'] },
    })
    const service = new VerifierService(verifierAgent() as never, verifierOptions())

    await expect(service.ensureInitialized()).rejects.toThrow('does not match the agent DID')
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
  })

  it.each([
    ['unresolvable', 'could not be resolved'],
    ['unbound', 'authentication'],
  ] as const)('fails initialization for %s authentication key binding', async (binding, message) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const service = new VerifierService(verifierAgent() as never, verifierOptions())

    await expect(service.ensureInitialized()).rejects.toThrow(message)
  })

  it('creates a direct_post.jwt DCQL request for exactly the requested claims', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    await service.ensureInitialized()

    await expect(
      service.createRequest({ jsonSchemaCredentialId: 'employee', requestedClaims: ['name'] }),
    ).resolves.toEqual({
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

  it('honours an explicit per-request x5c signer', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    await service.ensureInitialized()

    await service.createRequest({
      jsonSchemaCredentialId: 'employee',
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

  it('fails an unknown credential type clearly without creating a request', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    await service.ensureInitialized()

    await expect(service.createRequest({ jsonSchemaCredentialId: 'unknown' })).rejects.toMatchObject({
      code: OpenId4VcErrorCode.UnknownCredentialType,
    })
    await expect(service.createRequest({ jsonSchemaCredentialId: 'unknown' })).rejects.toThrow(
      'no credential type with id "unknown"',
    )
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('requests every claim of the type when the caller names none', async () => {
    const { service, api } = await initializedVerifier()
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })

    await service.createRequest({ jsonSchemaCredentialId: 'employee' })

    expect(api.createAuthorizationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        dcql: {
          query: {
            credentials: [
              {
                id: 'employee',
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
      service.createRequest({ jsonSchemaCredentialId: 'employee', requestedClaims }),
    ).rejects.toMatchObject({ code: OpenId4VcErrorCode.InvalidPresentationRequest })
    await expect(
      service.createRequest({ jsonSchemaCredentialId: 'employee', requestedClaims }),
    ).rejects.toThrow(message)
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('returns only unverified state fields before Credo reaches ResponseVerified', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('RequestUriRetrieved'))
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).resolves.toEqual({
      id: 'session-id',
      jsonSchemaCredentialId: 'employee',
      requestedClaims: ['name'],
      state: 'RequestUriRetrieved',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T10:00:00.000Z'),
      cryptographicVerified: false,
      accepted: false,
    })
  })

  it('maps missing sessions to a typed error', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockRejectedValue(
      new RecordNotFoundError('not found', { recordType: 'OpenId4VcVerificationSessionRecord' }),
    )
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('missing')).rejects.toMatchObject({
      code: OpenId4VcErrorCode.UnknownVerificationSession,
    })
  })

  it('rejects sessions owned by another configured verifier', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('ResponseVerified', 'other-verifier'))
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).rejects.toMatchObject({
      code: OpenId4VcErrorCode.UnknownVerificationSession,
    })
  })

  it('reports a verified session it has not decided as RESOLVER_UNAVAILABLE', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).resolves.toMatchObject({
      state: 'ResponseVerified',
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict: 'RESOLVER_UNAVAILABLE', evidence: { authorized: null, queries: [] } },
    })
  })

  describe('verification sessions', () => {
    it('stores the credential type and the requested claims on the session it creates', async () => {
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

      await service.createRequest({ jsonSchemaCredentialId: 'employee', requestedClaims: ['name'] })

      expect(session.getTag('jsonSchemaCredentialId')).toBe('employee')
      expect(session.getTag('requestedClaims')).toEqual(['name'])
      expect(verificationSessionRepository.update).toHaveBeenCalledWith(expect.anything(), session)
    })

    it('summarizes a pending session with its request and no trust block', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValue(verificationSession())

      await expect(service.getVerificationSession('session-1')).resolves.toEqual({
        id: 'session-1',
        jsonSchemaCredentialId: 'employee',
        requestedClaims: ['name'],
        state: 'RequestCreated',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        cryptographicVerified: false,
        accepted: false,
      })
    })

    it('returns the stored decision of a verified session without deciding again', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      const stored = {
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
      session.metadata.set('openid4vc/verificationOutcome', stored)
      api.getVerificationSessionById.mockResolvedValue(session)

      await expect(service.getVerificationSession('session-1')).resolves.toMatchObject({
        state: 'ResponseVerified',
        ...stored,
      })
    })

    it('stores nothing for a verified session it has not decided', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      api.getVerificationSessionById.mockResolvedValue(session)

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

    it('lists a verified session that nobody read yet as verified but not accepted, without deciding', async () => {
      const { service, api } = await initializedVerifier()
      api.findVerificationSessionsByQuery.mockResolvedValue([
        verificationSession({ state: 'ResponseVerified' }),
      ])

      const sessions = await service.listVerificationSessions()

      expect(sessions).toEqual([
        {
          id: 'session-1',
          jsonSchemaCredentialId: 'employee',
          requestedClaims: ['name'],
          state: 'ResponseVerified',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          cryptographicVerified: true,
          accepted: false,
        },
      ])
      expect(verificationSessionRepository.update).not.toHaveBeenCalled()
    })

    it('lists a verified session from its stored decision', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      const stored = {
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
      session.metadata.set('openid4vc/verificationOutcome', stored)
      api.findVerificationSessionsByQuery.mockResolvedValue([session])

      const sessions = await service.listVerificationSessions()

      expect(sessions[0]).toMatchObject(stored)
    })

    it('deletes a session of this verifier and refuses a foreign one', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValueOnce(verificationSession())
      await service.deleteVerificationSession('session-1')
      expect(api.deleteVerificationSessionById).toHaveBeenCalledWith('session-1')

      api.getVerificationSessionById.mockResolvedValueOnce(verificationSession({ verifierId: 'other' }))
      await expect(service.deleteVerificationSession('session-1')).rejects.toMatchObject({
        code: OpenId4VcErrorCode.UnknownVerificationSession,
      })
      expect(api.deleteVerificationSessionById).toHaveBeenCalledTimes(1)
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
        jsonSchemaCredentialId: 'employee',
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
          jsonSchemaCredentialId: 'employee',
          requestedClaims: ['name'],
          queryLanguage: 'dcql',
          requestSigner: 'did',
        }),
      ).rejects.toMatchObject({ code: OpenId4VcErrorCode.RequestSigningKeyNotPublished })
    })
  })

  describe('ECS service display', () => {
    it('publishes the ECS Service name and logo in the client metadata', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
      const ecsClaims = { service: { name: 'Verana Demo', logoUri: 'https://agent.example/logo.svg' } }

      await new VerifierService(
        verifierAgent(api, AGENT_DID, ecsClaims) as never,
        verifierOptions(),
      ).ensureInitialized()

      expect(api.updateVerifierMetadata).toHaveBeenCalledWith({
        verifierId: 'verifier',
        clientMetadata: { client_name: 'Verana Demo', logo_uri: 'https://agent.example/logo.svg' },
      })
    })

    it('publishes no client metadata at all without an ECS Service claim', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })

      await new VerifierService(
        verifierAgent(api, AGENT_DID, { service: {} }) as never,
        verifierOptions(),
      ).ensureInitialized()

      expect(api.updateVerifierMetadata).toHaveBeenCalledWith({ verifierId: 'verifier' })
    })

    it('omits the logo when the ECS Service claim carries no logo URI', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })

      await new VerifierService(
        verifierAgent(api, AGENT_DID, { service: { name: 'Verana Demo' } }) as never,
        verifierOptions(),
      ).ensureInitialized()

      expect(api.updateVerifierMetadata).toHaveBeenCalledWith({
        verifierId: 'verifier',
        clientMetadata: { client_name: 'Verana Demo' },
      })
    })
  })
})
