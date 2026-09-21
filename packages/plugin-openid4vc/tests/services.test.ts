import type { OpenId4VcPluginOptions } from '../src/types'

import { AgentContext, ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import {
  OpenId4VcIssuanceSessionRepository,
  OpenId4VcVerificationSessionRepository,
} from '@credo-ts/openid4vc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IssuerService,
  UnknownCredentialConfigurationError,
  UnknownIssuanceSessionError,
} from '../src/services/IssuerService'
import {
  OpenId4VcVerifierRequestError,
  UnknownVerificationSessionError,
  UnknownVerifierPolicyError,
  VerifierService,
} from '../src/services/VerifierService'

const {
  findBoundVerificationMethodId,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  verdictFor,
  verifyKeyBoundToDid,
} = vi.hoisted(() => ({
  findBoundVerificationMethodId: vi.fn(),
  loadSigningCertificate: vi.fn(),
  publishDevelopmentSigningKey: vi.fn(),
  verdictFor: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
  publishDevelopmentSigningKey,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  findBoundVerificationMethodId,
  verifyKeyBoundToDid,
}))
vi.mock('../src/trust/TrustClient', () => ({
  TrustClient: class {
    public verdictFor = verdictFor
  },
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

const issuerOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {},
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
    deleteIssuanceSessionById: vi.fn(),
    getIssuerMetadata: vi.fn().mockResolvedValue({ signedMetadataJwt: undefined }),
  }
}

const issuanceSessionRepository = { findByQuery: vi.fn() }

function issuanceSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    issuerId: 'issuer',
    state: 'OfferCreated',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: undefined,
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    errorMessage: undefined,
    credentialOfferPayload: { credential_configuration_ids: ['employee'] },
    ...overrides,
  }
}

const AGENT_CONTEXT = Symbol('agent-context')
const METADATA_PAYLOAD = {
  credential_issuer: 'https://agent.example/oid4vci/issuer',
  sub: 'https://agent.example/oid4vci/issuer',
  iat: 1_784_635_200,
}

function credoSignedMetadata(header: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode(header)}.${encode(METADATA_PAYLOAD)}.signature`
}

function jwsService() {
  return { createJwsCompact: vi.fn().mockResolvedValue('re-signed.metadata.jwt') }
}

function issuerAgent(
  api = issuerApi(),
  did: string | undefined = AGENT_DID,
  jws = jwsService(),
  ecsClaims?: { service?: Record<string, string | undefined> },
) {
  return {
    did,
    ecsClaims,
    dids: { resolve: () => undefined },
    genericRecords: { findById: async () => null, save: () => undefined, update: () => undefined },
    kms: {},
    x509: {},
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === AgentContext) return AGENT_CONTEXT
        if (token === OpenId4VcIssuanceSessionRepository) return issuanceSessionRepository
        return jws
      },
    },
    modules: { openId4Vc: { issuer: api } },
  }
}

const leafCertificate = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
  toString: () => 'leaf-certificate',
}
const rootCertificate = {
  subject: 'CN=Example Root',
  issuer: 'CN=Example Root',
  toString: () => 'root-certificate',
}

function issuerSigningHandle() {
  return {
    certificate: leafCertificate,
    chain: [leafCertificate, rootCertificate],
    keyId: 'issuer-key',
    development: false,
  }
}

async function initializedIssuer(
  overrides: {
    issuer?: Partial<NonNullable<OpenId4VcPluginOptions['issuer']>>
    issuerMissing?: boolean
  } = {},
) {
  const api = issuerApi()
  if (overrides.issuerMissing) {
    api.getIssuerByIssuerId.mockRejectedValue(new RecordNotFoundError('missing', { recordType: 'issuer' }))
  } else {
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
  }

  const configured = issuerOptions()
  if (overrides.issuer && configured.issuer) Object.assign(configured.issuer, overrides.issuer)

  const service = new IssuerService(issuerAgent(api) as never, configured)
  await service.ensureInitialized()
  return { service, api }
}

describe('IssuerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSigningCertificate.mockResolvedValue(issuerSigningHandle())
    publishDevelopmentSigningKey.mockResolvedValue(undefined)
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  it('keeps attestation off the record even where a key-attestation root is configured', async () => {
    const withRoot = issuerApi()
    withRoot.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const configured = issuerOptions()
    if (!configured.issuer) throw new Error('issuer options missing')
    configured.issuer.keyAttestationCertificates = ['wallet-provider-root']

    await new IssuerService(issuerAgent(withRoot) as never, configured).ensureInitialized()

    const proofTypes =
      withRoot.createIssuer.mock.calls[0][0].credentialConfigurationsSupported.employee.proof_types_supported
    // The record is what every wallet reads. `attestation` is added per-request for openid4vci-kt
    // only; on the record it makes swiyu's closed ProofType enum throw and kills the offer.
    expect(Object.keys(proofTypes).sort()).toEqual(['jwt'])
    expect(proofTypes.attestation).toBeUndefined()
  })

  it('creates the configured issuer with only dc+sd-jwt, ES256, and JWK holder binding', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())

    await service.ensureInitialized()

    expect(api.createIssuer).toHaveBeenCalledWith({
      issuerId: 'issuer',
      metadataSigner: {
        method: 'x5c',
        x5c: [leafCertificate],
      },
      credentialConfigurationsSupported: {
        employee: {
          format: 'dc+sd-jwt',
          vct: 'https://agent.example/oid4vc/vct/employee',
          scope: 'employee',
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

  it('signs development issuer metadata with its self-signed leaf certificate', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...issuerSigningHandle(),
      chain: [leafCertificate],
      development: true,
    })
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())

    await service.ensureInitialized()

    expect(api.createIssuer).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSigner: {
          method: 'x5c',
          x5c: [leafCertificate],
        },
      }),
    )
  })

  it('re-signs the DID-signed metadata under both kid and the certificate chain', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.getIssuerMetadata.mockResolvedValue({
      signedMetadataJwt: credoSignedMetadata({
        alg: 'ES256',
        typ: 'openidvci-issuer-metadata+jwt',
        kid: `${AGENT_DID}#openid4vc-development-issuer`,
      }),
    })
    const jws = jwsService()
    const service = new IssuerService(issuerAgent(api, AGENT_DID, jws) as never, issuerOptions())

    await service.ensureInitialized()

    expect(jws.createJwsCompact).toHaveBeenCalledWith(AGENT_CONTEXT, {
      payload: Buffer.from(JSON.stringify(METADATA_PAYLOAD), 'utf8'),
      keyId: 'issuer-key',
      protectedHeaderOptions: {
        alg: 'ES256',
        typ: 'openidvci-issuer-metadata+jwt',
        kid: `${AGENT_DID}#openid4vc-development-issuer`,
        x5c: ['leaf-certificate'],
      },
    })
    expect(service.getSignedMetadataJwt()).toBe('re-signed.metadata.jwt')
  })

  // The demo cast signs in development mode, where the whole chain is one self-signed leaf. Filtering
  // it as a trust anchor would leave an empty x5c, which NL Wallet rejects as a non-empty vector.
  it('carries the development self-signed leaf as the whole metadata certificate chain', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...issuerSigningHandle(),
      chain: [leafCertificate],
      development: true,
    })
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.getIssuerMetadata.mockResolvedValue({
      signedMetadataJwt: credoSignedMetadata({
        alg: 'ES256',
        typ: 'openidvci-issuer-metadata+jwt',
        kid: `${AGENT_DID}#openid4vc-development-issuer`,
      }),
    })
    const jws = jwsService()

    await new IssuerService(issuerAgent(api, AGENT_DID, jws) as never, issuerOptions()).ensureInitialized()

    const { protectedHeaderOptions } = jws.createJwsCompact.mock.calls[0][1]
    expect(protectedHeaderOptions.x5c).toEqual(['leaf-certificate'])
    expect(protectedHeaderOptions.kid).toBe(`${AGENT_DID}#openid4vc-development-issuer`)
  })

  it('keeps the self-signed trust anchor out of the metadata certificate chain', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.getIssuerMetadata.mockResolvedValue({
      signedMetadataJwt: credoSignedMetadata({ alg: 'ES256', typ: 'openidvci-issuer-metadata+jwt' }),
    })
    const jws = jwsService()

    await new IssuerService(issuerAgent(api, AGENT_DID, jws) as never, issuerOptions()).ensureInitialized()

    const { protectedHeaderOptions } = jws.createJwsCompact.mock.calls[0][1]
    expect(protectedHeaderOptions.x5c).toEqual(['leaf-certificate'])
    expect(protectedHeaderOptions.kid).toBeUndefined()
  })

  it('serves no signed metadata when the issuer record carries none', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const jws = jwsService()
    const service = new IssuerService(issuerAgent(api, AGENT_DID, jws) as never, issuerOptions())

    await service.ensureInitialized()

    expect(jws.createJwsCompact).not.toHaveBeenCalled()
    expect(service.getSignedMetadataJwt()).toBeUndefined()
  })

  it('fails initialization on a signed metadata header it cannot read', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.getIssuerMetadata.mockResolvedValue({ signedMetadataJwt: 'not-a-jwt.payload.signature' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())

    await expect(service.ensureInitialized()).rejects.toThrow('unreadable protected header')
  })

  it('updates an existing configured issuer and initializes only once under concurrency', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())

    await Promise.all([service.ensureInitialized(), service.ensureInitialized(), service.ensureInitialized()])

    expect(loadSigningCertificate).toHaveBeenCalledWith(
      expect.anything(),
      issuerOptions().issuer!.signing,
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

  it('retries initialization after a failed first attempt', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
  })

  it('requires an agent DID before loading signing material', async () => {
    const agentWithoutDid = { ...issuerAgent(), did: undefined }
    const service = new IssuerService(agentWithoutDid as never, issuerOptions())

    await expect(service.ensureInitialized()).rejects.toThrow('agent DID')
    expect(loadSigningCertificate).not.toHaveBeenCalled()
  })

  it('rejects a signing certificate whose DID does not match the agent DID', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...issuerSigningHandle(),
      certificate: { ...leafCertificate, sanUriNames: ['did:example:attacker'] },
    })
    const service = new IssuerService(issuerAgent() as never, issuerOptions())

    await expect(service.ensureInitialized()).rejects.toThrow('does not match the agent DID')
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
  })

  it.each([
    ['unresolvable', 'could not be resolved'],
    ['unbound', 'assertionMethod'],
  ] as const)('fails initialization for %s DID key binding', async (binding, message) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const service = new IssuerService(issuerAgent() as never, issuerOptions())

    await expect(service.ensureInitialized()).rejects.toThrow(message)
  })

  it('does not treat an issuer lookup failure as a missing issuer', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(new Error('storage unavailable'))
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())

    await expect(service.ensureInitialized()).rejects.toThrow('storage unavailable')
    expect(api.createIssuer).not.toHaveBeenCalled()
  })

  it('fails credential mapping clearly before initialization', async () => {
    const service = new IssuerService(issuerAgent() as never, issuerOptions())

    await expect(
      service.mapCredentialRequest({ credentialConfigurationId: 'employee' } as never),
    ).rejects.toThrow('not initialized')
  })

  it('initializes on demand when an offer is requested after a failed boot', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: { id: 'session-1' },
    })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await expect(
      service.createOffer({
        credentialConfigurationId: 'employee',
        claims: { name: 'Ada', role: 'engineer' },
        ttlSeconds: 3_600,
      }),
    ).resolves.toEqual({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSessionId: 'session-1',
    })
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
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    const result = await service.createOffer({
      credentialConfigurationId: 'employee',
      claims: { name: 'Ada', role: 'engineer' },
      ttlSeconds: 3_600,
    })

    expect(api.createCredentialOffer).toHaveBeenCalledWith({
      issuerId: 'issuer',
      credentialConfigurationIds: ['employee'],
      preAuthorizedCodeFlowConfig: {},
      issuanceMetadata: { claims: { name: 'Ada', role: 'engineer' }, ttlSeconds: 3_600 },
    })
    expect(result).toEqual({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSessionId: 'session-id',
    })
  })

  it('omits an absent optional claim from the offer metadata', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: { id: 'session-id' },
    })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await service.createOffer({
      credentialConfigurationId: 'employee',
      claims: { name: 'Ada' },
      ttlSeconds: 3_600,
    })

    expect(api.createCredentialOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        issuanceMetadata: { claims: { name: 'Ada' }, ttlSeconds: 3_600 },
      }),
    )
  })

  it.each([
    [{}, 'at least one'],
    [{ name: '', role: 'engineer' }, "claim 'name'"],
    [{ name: 'Ada', role: 'engineer', admin: true }, "unknown claim 'admin'"],
    [null, 'claims must be an object'],
  ])('rejects invalid offer claims %#', async (claims, message) => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await expect(
      service.createOffer({ credentialConfigurationId: 'employee', claims, ttlSeconds: 3_600 }),
    ).rejects.toThrow(message)
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it.each([59, 7_776_001, '3600', undefined])('rejects an offer lifetime of %s', async ttlSeconds => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await expect(
      service.createOffer({ credentialConfigurationId: 'employee', claims: { name: 'Ada' }, ttlSeconds }),
    ).rejects.toThrow('ttlSeconds')
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('maps validated claims to one short-lived dc+sd-jwt credential per JWK holder key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'))
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    const mapped = await service.mapCredentialRequest({
      credentialConfigurationId: 'employee',
      issuanceSession: {
        issuanceMetadata: { claims: { name: 'Ada', role: 'engineer' }, ttlSeconds: 3_600 },
      },
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
            x5c: [leafCertificate],
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
    const unsafeOptions = issuerOptions()
    unsafeOptions.credentialConfigurations[0].claims.push('exp')
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, unsafeOptions)
    await service.ensureInitialized()

    const mapped = await service.mapCredentialRequest({
      credentialConfigurationId: 'employee',
      issuanceSession: {
        issuanceMetadata: { claims: { name: 'Ada', role: 'engineer', exp: 1 }, ttlSeconds: 3_600 },
      },
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
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    const mapped = await service.mapCredentialRequest({
      credentialConfigurationId: 'employee',
      issuanceSession: {
        issuanceMetadata: { claims: { name: 'Ada', role: 'engineer' }, ttlSeconds: 3_600 },
      },
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
    [{ claims: {}, ttlSeconds: 3_600 }, 'at least one'],
    [{ claims: { name: 'Ada', role: 'engineer', admin: true }, ttlSeconds: 3_600 }, "unknown claim 'admin'"],
    [{ claims: { name: 'Ada' } }, 'ttlSeconds'],
  ])('rejects invalid issuance metadata %#', async (issuanceMetadata, message) => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
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
      issuerId: 'issuer',
      state: 'OfferCreated',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      preAuthorizedCode: 'secret-code',
      issuanceMetadata: { name: 'Ada', role: 'engineer' },
      credentialOfferPayload: { credential_configuration_ids: ['employee'], grants: { secret: true } },
    })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await expect(service.getIssuanceSession('session-id')).resolves.toEqual({
      id: 'session-id',
      credentialConfigurationId: 'employee',
      state: 'OfferCreated',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T10:00:00.000Z'),
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
    })
  })

  describe('issuance sessions', () => {
    it('reads a session of this issuer as a summary without claims, offer URL or code', async () => {
      const { service, api } = await initializedIssuer()
      api.getIssuanceSessionById.mockResolvedValue(
        issuanceSession({ preAuthorizedCode: 'secret', issuanceMetadata: { name: 'Ada' } }),
      )

      const summary = await service.getIssuanceSession('session-1')

      expect(summary).toEqual({
        id: 'session-1',
        credentialConfigurationId: 'employee',
        state: 'OfferCreated',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      })
    })

    it('reports an unknown or foreign session as unknown', async () => {
      const { service, api } = await initializedIssuer()
      api.getIssuanceSessionById.mockRejectedValueOnce(
        new RecordNotFoundError('missing', { recordType: 'session' }),
      )
      await expect(service.getIssuanceSession('missing')).rejects.toBeInstanceOf(UnknownIssuanceSessionError)

      api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession({ issuerId: 'other-issuer' }))
      await expect(service.getIssuanceSession('session-1')).rejects.toBeInstanceOf(
        UnknownIssuanceSessionError,
      )
    })

    it('lists only the sessions of this issuer', async () => {
      const { service } = await initializedIssuer()
      issuanceSessionRepository.findByQuery.mockResolvedValue([
        issuanceSession(),
        issuanceSession({ id: 'session-2', state: 'Completed' }),
      ])

      const sessions = await service.listIssuanceSessions()

      expect(issuanceSessionRepository.findByQuery).toHaveBeenCalledWith(expect.anything(), {
        issuerId: 'issuer',
      })
      expect(sessions.map(session => [session.id, session.state])).toEqual([
        ['session-1', 'OfferCreated'],
        ['session-2', 'Completed'],
      ])
    })

    it('deletes a session of this issuer and refuses a foreign one', async () => {
      const { service, api } = await initializedIssuer()
      api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession())
      await service.deleteIssuanceSession('session-1')
      expect(api.deleteIssuanceSessionById).toHaveBeenCalledWith('session-1')

      api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession({ issuerId: 'other-issuer' }))
      await expect(service.deleteIssuanceSession('session-1')).rejects.toBeInstanceOf(
        UnknownIssuanceSessionError,
      )
      expect(api.deleteIssuanceSessionById).toHaveBeenCalledTimes(1)
    })

    it('rejects an offer for an unknown credential configuration with a dedicated error', async () => {
      const { service } = await initializedIssuer()
      await expect(
        service.createOffer({
          credentialConfigurationId: 'missing',
          claims: { name: 'Ada', role: 'engineer' },
          ttlSeconds: 3_600,
        }),
      ).rejects.toBeInstanceOf(UnknownCredentialConfigurationError)
    })
  })

  describe('ECS service display', () => {
    it('publishes the ECS Service name and logo in the issuer metadata', async () => {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockRejectedValue(new RecordNotFoundError('missing', { recordType: 'issuer' }))
      const ecsClaims = { service: { name: 'Verana Demo', logoUri: 'https://agent.example/logo.svg' } }

      await new IssuerService(
        issuerAgent(api, AGENT_DID, jwsService(), ecsClaims) as never,
        issuerOptions(),
      ).ensureInitialized()

      expect(api.createIssuer).toHaveBeenCalledWith(
        expect.objectContaining({
          display: [{ name: 'Verana Demo', locale: 'en', logo: { uri: 'https://agent.example/logo.svg' } }],
        }),
      )
    })

    it('publishes no display at all without an ECS Service claim', async () => {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockRejectedValue(new RecordNotFoundError('missing', { recordType: 'issuer' }))

      await new IssuerService(
        issuerAgent(api, AGENT_DID, jwsService(), { service: {} }) as never,
        issuerOptions(),
      ).ensureInitialized()

      expect(api.createIssuer.mock.calls[0][0]).not.toHaveProperty('display')
    })

    it('omits the logo when the ECS Service claim carries no logo URI', async () => {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockRejectedValue(new RecordNotFoundError('missing', { recordType: 'issuer' }))

      await new IssuerService(
        issuerAgent(api, AGENT_DID, jwsService(), { service: { name: 'Verana Demo' } }) as never,
        issuerOptions(),
      ).ensureInitialized()

      expect(api.createIssuer).toHaveBeenCalledWith(
        expect.objectContaining({ display: [{ name: 'Verana Demo', locale: 'en' }] }),
      )
    })

    it('refreshes the x5c signer on an issuer record that already exists', async () => {
      const { api } = await initializedIssuer()
      expect(api.createIssuer).not.toHaveBeenCalled()
      expect(api.updateIssuerMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataSigner: { method: 'x5c', x5c: [leafCertificate] },
        }),
      )
    })
  })
})

const ISSUER_DID = 'did:web:issuer.example'
const VCT = 'https://agent.example/oid4vc/vct/employee'
const VTJSC_ID = 'https://agent.example/vt/employee.json'

const verifierOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  verifier: {},
  trust: {
    resolverUrl: 'https://resolver.example/v1/trust',
    timeoutMs: 5_000,
    allowedDidWebHosts: ['issuer.example'],
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
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === OpenId4VcVerificationSessionRepository) return verificationSessionRepository
        if (token === AgentContext) return {}
        return {}
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
const issuerLeaf = {
  sanUriNames: [ISSUER_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
}

function verifierSigningHandle() {
  return {
    certificate: signingLeaf,
    chain: [signingLeaf, signingRoot],
    keyId: 'verifier-key',
    development: false,
  }
}

function verificationSession(overrides: Record<string, unknown> = {}) {
  const tags: Record<string, unknown> = { policyId: 'employee-name' }
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
    verdictFor.mockResolvedValue(trust('TRUSTED_AUTHORIZED'))
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
      { allowedWebHosts: ['agent.example'], timeoutMs: 5_000 },
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

  it('creates a direct_post.jwt DCQL request for exactly the selected policy', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
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

  it('honours an explicit per-request x5c signer', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    api.createAuthorizationRequest.mockResolvedValue({
      authorizationRequest: 'openid4vp://?request_uri=opaque',
      verificationSession: session('RequestCreated'),
    })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    await service.ensureInitialized()

    await service.createRequest('employee-name', 'dcql', 'x5c')

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

  it('fails unknown policies clearly without creating a request', async () => {
    const api = verifierApi()
    api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    await service.ensureInitialized()

    await expect(service.createRequest('unknown')).rejects.toBeInstanceOf(UnknownVerifierPolicyError)
    await expect(service.createRequest('unknown')).rejects.toThrow("unknown verifier policy 'unknown'")
    expect(api.createAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('returns only unverified state fields before Credo reaches ResponseVerified', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('RequestUriRetrieved'))
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).resolves.toEqual({
      id: 'session-id',
      policyId: 'employee-name',
      state: 'RequestUriRetrieved',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T10:00:00.000Z'),
      cryptographicVerified: false,
      accepted: false,
    })
    expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
    expect(verdictFor).not.toHaveBeenCalled()
  })

  it('maps missing sessions to a typed error', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockRejectedValue(
      new RecordNotFoundError('not found', { recordType: 'OpenId4VcVerificationSessionRecord' }),
    )
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('missing')).rejects.toBeInstanceOf(
      UnknownVerificationSessionError,
    )
    expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
  })

  it('rejects sessions owned by another configured verifier', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session('ResponseVerified', 'other-verifier'))
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).rejects.toBeInstanceOf(
      UnknownVerificationSessionError,
    )
    expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
  })

  it('maps a session removed between state and verified-response reads to the typed error', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockRejectedValue(
      new RecordNotFoundError('not found', { recordType: 'OpenId4VcVerificationSessionRecord' }),
    )
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).rejects.toBeInstanceOf(
      UnknownVerificationSessionError,
    )
    expect(verdictFor).not.toHaveBeenCalled()
  })

  it('accepts only a Credo-verified, key-bound, exactly authorized SD-JWT presentation', async () => {
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(verifiedResponse())
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    const result = await service.getVerificationSession('session-id')

    expect(result).toEqual({
      id: 'session-id',
      policyId: 'employee-name',
      state: 'ResponseVerified',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T10:00:00.000Z'),
      cryptographicVerified: true,
      accepted: true,
      trust: trust('TRUSTED_AUTHORIZED'),
      credential: { vct: VCT, disclosedClaims: { name: 'Ada' } },
    })
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(
      expect.anything(),
      ISSUER_DID,
      PUBLIC_JWK,
      ['assertionMethod'],
      { allowedWebHosts: ['issuer.example'], timeoutMs: 5_000 },
    )
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
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).resolves.toMatchObject({
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
    const api = verifierApi()
    api.getVerificationSessionById.mockResolvedValue(session())
    api.getVerifiedAuthorizationResponse.mockResolvedValue(verifiedResponse())
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())
    await service.ensureInitialized()

    verifyKeyBoundToDid.mockResolvedValue(binding)

    await expect(service.getVerificationSession('session-id')).resolves.toMatchObject({
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
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    const result = await service.getVerificationSession('session-id')

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
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).resolves.toMatchObject({
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
    const service = new VerifierService(verifierAgent(api) as never, verifierOptions())

    await expect(service.getVerificationSession('session-id')).rejects.toThrow('changed while reading')
    await expect(service.getVerificationSession('session-id')).resolves.toMatchObject({
      accepted: false,
      trust: { verdict: 'UNTRUSTED', evidence: { queries: [] } },
    })
    expect(verdictFor).not.toHaveBeenCalled()
  })

  describe('verification sessions', () => {
    it('stores the policy id on the session it creates', async () => {
      const { service, api } = await initializedVerifier()
      let tag: unknown
      const session = verificationSession({
        getTag: () => tag,
        setTag: (_name: string, value: unknown) => {
          tag = value
        },
      })
      api.createAuthorizationRequest.mockResolvedValue({
        authorizationRequest: 'openid4vp://request',
        verificationSession: session,
      })

      await service.createRequest('employee-name')

      expect(session.getTag('policyId')).toBe('employee-name')
      expect(verificationSessionRepository.update).toHaveBeenCalledWith(expect.anything(), session)
    })

    it('summarizes a pending session with its policy and no trust block', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValue(verificationSession())

      await expect(service.getVerificationSession('session-1')).resolves.toEqual({
        id: 'session-1',
        policyId: 'employee-name',
        state: 'RequestCreated',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        cryptographicVerified: false,
        accepted: false,
      })
      expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
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
            vtjscId: VTJSC_ID,
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
      expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
      expect(verdictFor).not.toHaveBeenCalled()
    })

    it('does not store a RESOLVER_UNAVAILABLE decision', async () => {
      const { service, api } = await initializedVerifier()
      const session = verificationSession({ state: 'ResponseVerified' })
      api.getVerificationSessionById.mockResolvedValue(session)
      api.getVerifiedAuthorizationResponse.mockResolvedValue(verifiedResponse([presentation()], session))
      verifyKeyBoundToDid.mockResolvedValue('unresolvable')

      const summary = await service.getVerificationSession('session-1')

      expect(summary.trust?.verdict).toBe('RESOLVER_UNAVAILABLE')
      expect(session.metadata.get('openid4vc/verificationOutcome')).toBeNull()
      expect(verificationSessionRepository.update).not.toHaveBeenCalled()
    })

    it('answers RESOLVER_UNAVAILABLE and stores nothing when no resolver is configured', async () => {
      const api = verifierApi()
      api.getVerifierByVerifierId.mockResolvedValue({ verifierId: 'verifier' })
      const service = new VerifierService(verifierAgent(api) as never, {
        ...verifierOptions(),
        trust: undefined,
      })
      const session = verificationSession({ state: 'ResponseVerified' })
      api.getVerificationSessionById.mockResolvedValue(session)

      const summary = await service.getVerificationSession('session-1')

      expect(summary).toMatchObject({
        cryptographicVerified: true,
        accepted: false,
        trust: { verdict: 'RESOLVER_UNAVAILABLE' },
      })
      expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
      expect(session.metadata.get('openid4vc/verificationOutcome')).toBeNull()
      expect(verificationSessionRepository.update).not.toHaveBeenCalled()
    })

    it('lists only the sessions of this verifier', async () => {
      const { service, api } = await initializedVerifier()
      api.findVerificationSessionsByQuery.mockResolvedValue([
        verificationSession(),
        verificationSession({ id: 'session-2' }),
      ])

      const sessions = await service.listVerificationSessions()

      expect(api.findVerificationSessionsByQuery).toHaveBeenCalledWith({ verifierId: 'verifier' })
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
          policyId: 'employee-name',
          state: 'ResponseVerified',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          cryptographicVerified: true,
          accepted: false,
        },
      ])
      expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
      expect(verdictFor).not.toHaveBeenCalled()
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
            vtjscId: VTJSC_ID,
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
      expect(api.getVerifiedAuthorizationResponse).not.toHaveBeenCalled()
    })

    it('deletes a session of this verifier and refuses a foreign one', async () => {
      const { service, api } = await initializedVerifier()
      api.getVerificationSessionById.mockResolvedValueOnce(verificationSession())
      await service.deleteVerificationSession('session-1')
      expect(api.deleteVerificationSessionById).toHaveBeenCalledWith('session-1')

      api.getVerificationSessionById.mockResolvedValueOnce(verificationSession({ verifierId: 'other' }))
      await expect(service.deleteVerificationSession('session-1')).rejects.toBeInstanceOf(
        UnknownVerificationSessionError,
      )
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

      await service.createRequest('employee-name', 'dcql', 'did')

      expect(api.createAuthorizationRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestSigner: { method: 'did', didUrl: `${AGENT_DID}#openid4vc-verifier` },
        }),
      )
    })

    it('fails a did-signed request when the DID does not publish the signing key', async () => {
      findBoundVerificationMethodId.mockResolvedValue(null)
      const { service } = await initializedVerifier()
      await expect(service.createRequest('employee-name', 'dcql', 'did')).rejects.toBeInstanceOf(
        OpenId4VcVerifierRequestError,
      )
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
