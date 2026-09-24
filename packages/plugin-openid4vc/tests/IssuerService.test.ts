import type { OpenId4VcPluginOptions } from '../src/types'

import { ClaimFormat, JwkDidResolver, RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionRepository, OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import { requireIssuerService } from '../src/services/issuerHolder'
import { IssuerService } from '../src/services/IssuerService'

const { loadSigningCertificate, publishDevelopmentSigningKey, verifyKeyBoundToDid } = vi.hoisted(() => ({
  loadSigningCertificate: vi.fn(),
  publishDevelopmentSigningKey: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
  publishDevelopmentSigningKey,
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
})

function issuerApi() {
  return {
    getIssuerByIssuerId: vi.fn(),
    createIssuer: vi.fn(),
    updateIssuerMetadata: vi.fn(),
    createCredentialOffer: vi.fn(),
    getIssuanceSessionById: vi.fn(),
    deleteIssuanceSessionById: vi.fn(),
  }
}

const issuanceSessionRepository = { findByQuery: vi.fn(), update: vi.fn() }
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function issuanceSession(overrides: Record<string, unknown> = {}) {
  const tags: Record<string, unknown> = { jsonSchemaCredentialId: 'employee' }
  return {
    id: 'session-1',
    issuerId: 'issuer',
    state: 'OfferCreated',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: undefined,
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    errorMessage: undefined,
    credentialOfferPayload: { credential_configuration_ids: ['employee'] },
    getTag: (name: string) => tags[name],
    setTag: (name: string, value: unknown) => {
      tags[name] = value
    },
    ...overrides,
  }
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
  const resolvers: unknown[] = []
  return {
    did,
    ecsClaims,
    config: { logger },
    dids: {
      resolve: () => undefined,
      config: { resolvers, addResolver: (resolver: unknown) => resolvers.push(resolver) },
    },
    genericRecords: { findById: async () => null, save: () => undefined, update: () => undefined },
    kms: {},
    x509: {},
    context: {
      dependencyManager: {
        resolve: (token: unknown) => {
          if (token === OpenId4VcIssuanceSessionRepository) return issuanceSessionRepository
          return jws
        },
      },
    },
    modules: { openId4Vc: { issuer: api } },
  }
}

const leafCertificate = {
  sanUriNames: [AGENT_DID],
  publicJwk: { toJson: () => PUBLIC_JWK },
  rawCertificate: Buffer.from('leaf-certificate'),
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

  it('initializes on the Nest module hook, and publishes the did:jwk resolver ahead of it', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const agent = issuerAgent(api)
    const service = new IssuerService(agent as never, issuerOptions())

    await service.onModuleInit()
    await service.onModuleInit()

    expect(agent.dids.config.resolvers).toHaveLength(1)
    expect(agent.dids.config.resolvers[0]).toBeInstanceOf(JwkDidResolver)
    expect(loadSigningCertificate).toHaveBeenCalledOnce()
    expect(requireIssuerService()).toBe(service)
    expect(service.getJwtVcIssuerMetadata()).toEqual({
      issuer: 'https://agent.example',
      jwks: { keys: [PUBLIC_JWK] },
    })
  })

  it('logs the certificate mode and the published verification method at startup', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    loadSigningCertificate.mockResolvedValue({ ...issuerSigningHandle(), development: true })
    publishDevelopmentSigningKey.mockResolvedValue(`${AGENT_DID}#openid4vc-development-issuer`)

    await new IssuerService(issuerAgent(api) as never, issuerOptions()).ensureInitialized()

    expect(logger.info).toHaveBeenCalledWith(
      `[OpenID4VC] issuer signs with a development certificate, published as ${AGENT_DID}#openid4vc-development-issuer`,
    )
  })

  it('initializes the issuer on the first certificate read', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())

    await expect(service.getCertificateInfo()).resolves.toMatchObject({
      role: 'issuer',
      development: false,
    })
    expect(loadSigningCertificate).toHaveBeenCalledOnce()
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
    // The record is what every wallet reads. `attestation` is added per-request for the legacy accept
    // header only; on the record a closed ProofType enum throws on it and kills the offer.
    expect(Object.keys(proofTypes).sort()).toEqual(['jwt'])
    expect(proofTypes.attestation).toBeUndefined()
    expect(proofTypes.jwt.key_attestations_required).toEqual({})
  })

  it('leaves the key-attestation requirement off the record without a key-attestation root', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )

    await new IssuerService(issuerAgent(api) as never, issuerOptions()).ensureInitialized()

    expect(
      api.createIssuer.mock.calls[0][0].credentialConfigurationsSupported.employee.proof_types_supported.jwt,
    ).toEqual({ proof_signing_alg_values_supported: ['ES256'] })
  })

  it('advertises the client attestation algorithms only with a wallet attestation root', async () => {
    const withRoot = issuerApi()
    withRoot.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const configured = issuerOptions()
    if (!configured.issuer) throw new Error('issuer options missing')
    configured.issuer.walletAttestationCertificates = ['wallet-provider-root']
    const { api } = await initializedIssuer()

    await new IssuerService(issuerAgent(withRoot) as never, configured).ensureInitialized()

    expect(withRoot.updateIssuerMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        dpopSigningAlgValuesSupported: ['ES256'],
        clientAttestationSigningAlgValuesSupported: ['ES256'],
        clientAttestationPopSigningAlgValuesSupported: ['ES256'],
      }),
    )
    const withoutRoot = api.updateIssuerMetadata.mock.calls[0][0]
    expect(withoutRoot.dpopSigningAlgValuesSupported).toEqual(['ES256'])
    expect(withoutRoot).not.toHaveProperty('clientAttestationSigningAlgValuesSupported')
    expect(withoutRoot).not.toHaveProperty('clientAttestationPopSigningAlgValuesSupported')
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
      dpopSigningAlgValuesSupported: ['ES256'],
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
    expect(verifyKeyBoundToDid).toHaveBeenCalledWith(expect.anything(), AGENT_DID, PUBLIC_JWK, [
      'assertionMethod',
    ])
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
      issuanceSession: issuanceSession({ id: 'session-1' }),
    })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await expect(
      service.createOffer({
        jsonSchemaCredentialId: 'employee',
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
      issuanceSession: issuanceSession({
        id: 'session-id',
        state: 'OfferCreated',
        createdAt: new Date('2026-07-21T10:00:00.000Z'),
        expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      }),
    })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    const result = await service.createOffer({
      jsonSchemaCredentialId: 'employee',
      claims: { name: 'Ada', role: 'engineer' },
      ttlSeconds: 3_600,
    })

    expect(api.createCredentialOffer).toHaveBeenCalledWith({
      issuerId: 'issuer',
      credentialConfigurationIds: ['employee'],
      preAuthorizedCodeFlowConfig: {},
      issuanceMetadata: { claims: { name: 'Ada', role: 'engineer' }, ttlSeconds: 3_600 },
    })
    expect(issuanceSessionRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'session-id' }),
    )
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
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await service.createOffer({
      jsonSchemaCredentialId: 'employee',
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
      service.createOffer({ jsonSchemaCredentialId: 'employee', claims, ttlSeconds: 3_600 }),
    ).rejects.toThrow(message)
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it.each([59, 7_776_001, '3600', undefined])('rejects an offer lifetime of %s', async ttlSeconds => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await expect(
      service.createOffer({ jsonSchemaCredentialId: 'employee', claims: { name: 'Ada' }, ttlSeconds }),
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
    api.getIssuanceSessionById.mockResolvedValue(
      issuanceSession({
        id: 'session-id',
        createdAt: new Date('2026-07-21T10:00:00.000Z'),
        expiresAt: new Date('2026-07-21T10:05:00.000Z'),
        preAuthorizedCode: 'secret-code',
        issuanceMetadata: { name: 'Ada', role: 'engineer' },
        credentialOfferPayload: { credential_configuration_ids: ['employee'], grants: { secret: true } },
      }),
    )
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions())
    await service.ensureInitialized()

    await expect(service.getIssuanceSession('session-id')).resolves.toEqual({
      id: 'session-id',
      jsonSchemaCredentialId: 'employee',
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
        jsonSchemaCredentialId: 'employee',
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
      await expect(service.getIssuanceSession('missing')).rejects.toMatchObject({
        code: AdminApiErrorCode.UnknownId,
      })

      api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession({ issuerId: 'other-issuer' }))
      await expect(service.getIssuanceSession('session-1')).rejects.toMatchObject({
        code: AdminApiErrorCode.UnknownId,
      })
    })

    it('lists only the sessions of this issuer and leaves the filters to the query', async () => {
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

      await service.listIssuanceSessions({
        jsonSchemaCredentialId: 'badge',
        statusListId: 'list-1',
        state: OpenId4VcIssuanceSessionState.Completed,
      })

      expect(issuanceSessionRepository.findByQuery).toHaveBeenLastCalledWith(expect.anything(), {
        issuerId: 'issuer',
        jsonSchemaCredentialId: 'badge',
        statusListId: 'list-1',
        state: 'Completed',
      })
    })

    it('deletes a session of this issuer and refuses a foreign one', async () => {
      const { service, api } = await initializedIssuer()
      api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession())
      await service.deleteIssuanceSession('session-1')
      expect(api.deleteIssuanceSessionById).toHaveBeenCalledWith('session-1')

      api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession({ issuerId: 'other-issuer' }))
      await expect(service.deleteIssuanceSession('session-1')).rejects.toMatchObject({
        code: AdminApiErrorCode.UnknownId,
      })
      expect(api.deleteIssuanceSessionById).toHaveBeenCalledTimes(1)
    })

    it('rejects half a status list pair as invalid input and a whole one as an unknown list', async () => {
      const { service } = await initializedIssuer()
      const offer = { jsonSchemaCredentialId: 'employee', claims: { name: 'Ada' }, ttlSeconds: 3_600 }

      await expect(service.createOffer({ ...offer, statusListIndex: 0 })).rejects.toMatchObject({
        code: AdminApiErrorCode.InvalidInput,
      })
      await expect(service.createOffer({ ...offer, statusListId: 'list-1' })).rejects.toMatchObject({
        code: AdminApiErrorCode.InvalidInput,
      })
      await expect(
        service.createOffer({ ...offer, statusListId: 'list-1', statusListIndex: 0 }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.UnknownId })
    })

    it('rejects an offer for an unknown credential configuration with a dedicated error', async () => {
      const { service } = await initializedIssuer()
      await expect(
        service.createOffer({
          jsonSchemaCredentialId: 'missing',
          claims: { name: 'Ada', role: 'engineer' },
          ttlSeconds: 3_600,
        }),
      ).rejects.toMatchObject({ code: AdminApiErrorCode.UnknownId })
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
