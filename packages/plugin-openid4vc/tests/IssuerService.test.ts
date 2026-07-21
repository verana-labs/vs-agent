import type { OpenId4VcPluginOptions } from '../src/types'

import { ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IssuerService } from '../src/services/IssuerService'

const { loadSigningCertificate, verifyKeyBoundToDid } = vi.hoisted(() => ({
  loadSigningCertificate: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  verifyKeyBoundToDid,
}))

const AGENT_DID = 'did:web:agent.example'
const PUBLIC_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
  y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
}
const HOLDER_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'o0pHM_e14uztQfxTPY-bq8VlY4gK73YqkWQZyDTLQNQ',
  y: 'OeoQ8PF6k3JwXnKcHk4x1v3wFOhMB1d3Z5GZln0FrcA',
}

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {
    id: 'issuer',
    displayName: 'Example Issuer',
    signing: { development: { enabled: true, commonName: 'Example Issuer' } },
  },
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: 'https://agent.example/oid4vc/vct/employee',
      name: 'Employee credential',
      description: 'Proof of employment',
      vtjscId: 'https://agent.example/vt/employee.json',
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
      ttlSeconds: 3_600,
    },
  ],
  verifierPolicies: [],
})

function issuerApi() {
  return {
    getIssuerByIssuerId: vi.fn(),
    createIssuer: vi.fn(),
    updateIssuerMetadata: vi.fn(),
    createCredentialOffer: vi.fn(),
    getIssuanceSessionById: vi.fn(),
  }
}

function agent(api = issuerApi(), did: string | undefined = AGENT_DID) {
  return {
    did,
    dids: { resolve: vi.fn() },
    genericRecords: {},
    kms: {},
    x509: {},
    modules: { openId4Vc: { issuer: api } },
  }
}

const leafCertificate = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
  toString: () => 'leaf-certificate',
}
const rootCertificate = { toString: () => 'root-certificate' }

function signingHandle() {
  return {
    certificate: leafCertificate,
    chain: [leafCertificate, rootCertificate],
    keyId: 'issuer-key',
    development: false,
  }
}

describe('IssuerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSigningCertificate.mockResolvedValue(signingHandle())
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  it('creates the configured issuer with only dc+sd-jwt, ES256, and JWK holder binding', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const service = new IssuerService(agent(api) as never, options())

    await service.ensureInitialized()

    expect(api.createIssuer).toHaveBeenCalledWith({
      issuerId: 'issuer',
      display: [{ name: 'Example Issuer', locale: 'en' }],
      credentialConfigurationsSupported: {
        employee: {
          format: 'dc+sd-jwt',
          vct: 'https://agent.example/oid4vc/vct/employee',
          cryptographic_binding_methods_supported: ['jwk'],
          credential_signing_alg_values_supported: ['ES256'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
          credential_metadata: {
            display: [
              {
                name: 'Employee credential',
                description: 'Proof of employment',
                locale: 'en',
              },
            ],
            claims: [{ path: ['name'] }, { path: ['role'] }],
          },
        },
      },
    })
    expect(api.updateIssuerMetadata).not.toHaveBeenCalled()
  })

  it('updates an existing configured issuer and initializes only once under concurrency', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, options())

    await Promise.all([service.ensureInitialized(), service.ensureInitialized(), service.ensureInitialized()])

    expect(loadSigningCertificate).toHaveBeenCalledWith(
      expect.anything(),
      options().issuer!.signing,
      'https://agent.example',
      'issuer',
    )
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(
      expect.anything(),
      AGENT_DID,
      PUBLIC_JWK,
      ['assertionMethod'],
      { allowedWebHosts: ['agent.example'], timeoutMs: 5_000 },
    )
    expect(api.getIssuerByIssuerId).toHaveBeenCalledOnce()
    expect(api.updateIssuerMetadata).toHaveBeenCalledOnce()
    expect(api.createIssuer).not.toHaveBeenCalled()
  })

  it('requires an agent DID before loading signing material', async () => {
    const agentWithoutDid = { ...agent(), did: undefined }
    const service = new IssuerService(agentWithoutDid as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow('agent DID')
    expect(loadSigningCertificate).not.toHaveBeenCalled()
  })

  it('rejects a signing certificate whose DID does not match the agent DID', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...signingHandle(),
      certificate: { ...leafCertificate, sanUriNames: ['did:example:attacker'] },
    })
    const service = new IssuerService(agent() as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow('does not match the agent DID')
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
  })

  it.each([
    ['unresolvable', 'could not be resolved'],
    ['unbound', 'assertionMethod'],
  ] as const)('fails initialization for %s DID key binding', async (binding, message) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const service = new IssuerService(agent() as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow(message)
  })

  it('does not treat an issuer lookup failure as a missing issuer', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(new Error('storage unavailable'))
    const service = new IssuerService(agent(api) as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow('storage unavailable')
    expect(api.createIssuer).not.toHaveBeenCalled()
  })

  it('fails offer creation and credential mapping clearly before initialization', async () => {
    const service = new IssuerService(agent() as never, options())

    await expect(service.createOffer('employee', { name: 'Ada', role: 'engineer' })).rejects.toThrow(
      'not initialized',
    )
    await expect(
      service.mapCredentialRequest({ credentialConfigurationId: 'employee' } as never),
    ).rejects.toThrow('not initialized')
  })

  it('creates only a pre-authorized offer with validated claims as issuance metadata', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: {
        id: 'session-id',
        state: 'OfferCreated',
        createdAt: new Date('2026-07-21T10:00:00.000Z'),
        expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      },
    })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    const result = await service.createOffer('employee', { name: 'Ada', role: 'engineer' })

    expect(api.createCredentialOffer).toHaveBeenCalledWith({
      issuerId: 'issuer',
      credentialConfigurationIds: ['employee'],
      preAuthorizedCodeFlowConfig: {},
      issuanceMetadata: { name: 'Ada', role: 'engineer' },
    })
    expect(result).toEqual({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSessionId: 'session-id',
    })
  })

  it.each([
    [{ name: 'Ada' }, "claim 'role'"],
    [{ name: 'Ada', role: 'engineer', admin: true }, "unknown claim 'admin'"],
    [null, 'claims must be an object'],
  ])('rejects invalid offer claims %#', async (claims, message) => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    await expect(service.createOffer('employee', claims)).rejects.toThrow(message)
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('maps validated claims to one short-lived dc+sd-jwt credential per JWK holder key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'))
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    const mapped = await service.mapCredentialRequest({
      credentialConfigurationId: 'employee',
      issuanceSession: { issuanceMetadata: { name: 'Ada', role: 'engineer' } },
      holderBinding: {
        bindingMethod: 'jwk',
        proofType: 'jwt',
        keys: [{ method: 'jwk', jwk: HOLDER_JWK }],
      },
    } as never)

    expect(mapped).toEqual({
      type: 'credentials',
      format: ClaimFormat.SdJwtDc,
      credentials: [
        {
          payload: {
            vct: 'https://agent.example/oid4vc/vct/employee',
            iat: 1_784_635_200,
            exp: 1_784_638_800,
            name: 'Ada',
            role: 'engineer',
          },
          holder: { method: 'jwk', jwk: HOLDER_JWK },
          issuer: {
            method: 'x5c',
            x5c: [leafCertificate, rootCertificate],
            issuer: 'https://agent.example',
          },
          disclosureFrame: { _sd: ['name', 'role'] },
          headerType: 'dc+sd-jwt',
        },
      ],
    })
    vi.useRealTimers()
  })

  it('prevents supplied exp metadata from overriding the configured credential lifetime', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'))
    const unsafeOptions = options()
    unsafeOptions.credentialConfigurations[0].claims.push('exp')
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, unsafeOptions)
    await service.ensureInitialized()

    const mapped = await service.mapCredentialRequest({
      credentialConfigurationId: 'employee',
      issuanceSession: { issuanceMetadata: { name: 'Ada', role: 'engineer', exp: 1 } },
      holderBinding: {
        bindingMethod: 'jwk',
        proofType: 'jwt',
        keys: [{ method: 'jwk', jwk: HOLDER_JWK }],
      },
    } as never)

    expect(mapped.type).toBe('credentials')
    if (mapped.type !== 'credentials') throw new Error('expected credentials')
    const credential = mapped.credentials[0]
    if (!credential || !('payload' in credential)) throw new Error('expected SD-JWT credentials')
    expect(credential.payload.iat).toBe(1_784_635_200)
    expect(credential.payload.exp).toBe(1_784_638_800)
    vi.useRealTimers()
  })

  it('preserves a verified DID holder binding supplied by Credo', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    const mapped = await service.mapCredentialRequest({
      credentialConfigurationId: 'employee',
      issuanceSession: { issuanceMetadata: { name: 'Ada', role: 'engineer' } },
      holderBinding: {
        bindingMethod: 'did',
        proofType: 'jwt',
        keys: [{ method: 'did', jwk: HOLDER_JWK, didUrl: 'did:example:holder#key-1' }],
      },
    } as never)

    expect(mapped.type).toBe('credentials')
    if (mapped.type !== 'credentials') throw new Error('expected credentials')
    const credential = mapped.credentials[0]
    if (!credential || !('holder' in credential)) throw new Error('expected SD-JWT credentials')
    expect(credential.holder).toEqual({ method: 'did', didUrl: 'did:example:holder#key-1' })
  })

  it.each([
    [{ name: 'Ada' }, "claim 'role'"],
    [{ name: 'Ada', role: 'engineer', admin: true }, "unknown claim 'admin'"],
  ])('rejects invalid issuance metadata %#', async (issuanceMetadata, message) => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    await expect(
      service.mapCredentialRequest({
        credentialConfigurationId: 'employee',
        issuanceSession: { issuanceMetadata },
        holderBinding: { bindingMethod: 'jwk', proofType: 'jwt', keys: [] },
      } as never),
    ).rejects.toThrow(message)
  })

  it('returns only safe offer state fields', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.getIssuanceSessionById.mockResolvedValue({
      id: 'session-id',
      state: 'OfferCreated',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      preAuthorizedCode: 'secret-code',
      issuanceMetadata: { name: 'Ada', role: 'engineer' },
      credentialOfferPayload: { grants: { secret: true } },
    })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    await expect(service.getOfferState('session-id')).resolves.toEqual({
      id: 'session-id',
      state: 'OfferCreated',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
    })
  })

  it('returns VCT metadata with configured display and claim paths but no W3C credentialSchema', () => {
    const service = new IssuerService(agent() as never, options())

    const metadata = service.getVctMetadata('employee')

    expect(metadata).toEqual({
      vct: 'https://agent.example/oid4vc/vct/employee',
      name: 'Employee credential',
      description: 'Proof of employment',
      display: [
        {
          locale: 'en',
          name: 'Employee credential',
          description: 'Proof of employment',
        },
      ],
      claims: [{ path: ['name'] }, { path: ['role'] }],
    })
    expect(metadata).not.toHaveProperty('credentialSchema')
    expect(service.getVctMetadata('unknown')).toBeUndefined()
  })
})
