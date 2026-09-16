import type { OpenId4VcPluginOptions } from '../src/types'

import { AgentContext, ClaimFormat, RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionRepository } from '@credo-ts/openid4vc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IssuerService,
  UnknownCredentialConfigurationError,
  UnknownIssuanceSessionError,
} from '../src/services/IssuerService'

const {
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  verifyKeyBoundToDid,
  findBoundVerificationMethodId,
} = vi.hoisted(() => ({
  loadSigningCertificate: vi.fn(),
  publishDevelopmentSigningKey: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
  findBoundVerificationMethodId: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
  publishDevelopmentSigningKey,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  verifyKeyBoundToDid,
  findBoundVerificationMethodId,
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
    deleteIssuanceSessionById: vi.fn(),
    getIssuerMetadata: vi.fn().mockResolvedValue({ signedMetadataJwt: undefined }),
  }
}

const sessionRepository = { findByQuery: vi.fn() }

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

function agent(api = issuerApi(), did: string | undefined = AGENT_DID, jws = jwsService()) {
  return {
    did,
    dids: { resolve: vi.fn() },
    genericRecords: { findById: vi.fn().mockResolvedValue(null), save: vi.fn(), update: vi.fn() },
    kms: {},
    x509: {},
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === AgentContext) return AGENT_CONTEXT
        if (token === OpenId4VcIssuanceSessionRepository) return sessionRepository
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

function signingHandle() {
  return {
    certificate: leafCertificate,
    chain: [leafCertificate, rootCertificate],
    keyId: 'issuer-key',
    development: false,
  }
}

async function initialized(
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

  const configured = options()
  if (overrides.issuer && configured.issuer) Object.assign(configured.issuer, overrides.issuer)

  const service = new IssuerService(agent(api) as never, configured)
  await service.ensureInitialized()
  return { service, api }
}

describe('IssuerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSigningCertificate.mockResolvedValue(signingHandle())
    publishDevelopmentSigningKey.mockResolvedValue(undefined)
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  it('keeps attestation off the record even where a key-attestation root is configured', async () => {
    const withRoot = issuerApi()
    withRoot.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const configured = options()
    if (!configured.issuer) throw new Error('issuer options missing')
    configured.issuer.keyAttestationCertificates = ['wallet-provider-root']

    await new IssuerService(agent(withRoot) as never, configured).ensureInitialized()

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
    const service = new IssuerService(agent(api) as never, options())

    await service.ensureInitialized()

    expect(api.createIssuer).toHaveBeenCalledWith({
      issuerId: 'issuer',
      display: [{ name: 'Example Issuer', locale: 'en' }],
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

  it('signs new issuer metadata with the issuance certificate chain excluding the configured trust anchor', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const service = new IssuerService(agent(api) as never, options())

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

  it('signs development issuer metadata with its self-signed leaf certificate', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...signingHandle(),
      chain: [leafCertificate],
      development: true,
    })
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const service = new IssuerService(agent(api) as never, options())

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
    const service = new IssuerService(agent(api, AGENT_DID, jws) as never, options())

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
      ...signingHandle(),
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

    await new IssuerService(agent(api, AGENT_DID, jws) as never, options()).ensureInitialized()

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

    await new IssuerService(agent(api, AGENT_DID, jws) as never, options()).ensureInitialized()

    const { protectedHeaderOptions } = jws.createJwsCompact.mock.calls[0][1]
    expect(protectedHeaderOptions.x5c).toEqual(['leaf-certificate'])
    expect(protectedHeaderOptions.kid).toBeUndefined()
  })

  it('serves no signed metadata when the issuer record carries none', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const jws = jwsService()
    const service = new IssuerService(agent(api, AGENT_DID, jws) as never, options())

    await service.ensureInitialized()

    expect(jws.createJwsCompact).not.toHaveBeenCalled()
    expect(service.getSignedMetadataJwt()).toBeUndefined()
  })

  it('fails initialization on a signed metadata header it cannot read', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.getIssuerMetadata.mockResolvedValue({ signedMetadataJwt: 'not-a-jwt.payload.signature' })
    const service = new IssuerService(agent(api) as never, options())

    await expect(service.ensureInitialized()).rejects.toThrow('unreadable protected header')
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

  it('retries initialization after a failed first attempt', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(agent(api) as never, options())
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
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

  it('fails credential mapping clearly before initialization', async () => {
    const service = new IssuerService(agent() as never, options())

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
    const service = new IssuerService(agent(api) as never, options())
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await expect(service.createOffer('employee', { name: 'Ada', role: 'engineer' })).resolves.toEqual({
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

  it('omits an absent optional claim from the offer metadata', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: { id: 'session-id' },
    })
    const service = new IssuerService(agent(api) as never, options())
    await service.ensureInitialized()

    await service.createOffer('employee', { name: 'Ada' })

    expect(api.createCredentialOffer).toHaveBeenCalledWith(
      expect.objectContaining({ issuanceMetadata: { name: 'Ada' } }),
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
    [{}, 'at least one'],
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
      issuerId: 'issuer',
      state: 'OfferCreated',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      preAuthorizedCode: 'secret-code',
      issuanceMetadata: { name: 'Ada', role: 'engineer' },
      credentialOfferPayload: { credential_configuration_ids: ['employee'], grants: { secret: true } },
    })
    const service = new IssuerService(agent(api) as never, options())
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
      const { service, api } = await initialized()
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
      const { service, api } = await initialized()
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
      const { service } = await initialized()
      sessionRepository.findByQuery.mockResolvedValue([
        issuanceSession(),
        issuanceSession({ id: 'session-2', state: 'Completed' }),
      ])

      const sessions = await service.listIssuanceSessions()

      expect(sessionRepository.findByQuery).toHaveBeenCalledWith(expect.anything(), {
        issuerId: 'issuer',
      })
      expect(sessions.map(session => [session.id, session.state])).toEqual([
        ['session-1', 'OfferCreated'],
        ['session-2', 'Completed'],
      ])
    })

    it('deletes a session of this issuer and refuses a foreign one', async () => {
      const { service, api } = await initialized()
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
      const { service } = await initialized()
      await expect(service.createOffer('missing', { name: 'Ada', role: 'engineer' })).rejects.toBeInstanceOf(
        UnknownCredentialConfigurationError,
      )
    })
  })

  it('returns VCT metadata with configured display and claim paths but no W3C credentialSchema', () => {
    const service = new IssuerService(agent() as never, options())

    const metadata = service.getVctMetadata('employee')

    expect(metadata).toEqual({
      vct: 'https://agent.example/oid4vc/vct/employee',
      relatedJsonSchemaCredentialId: 'https://agent.example/vt/employee.json',
      name: 'Employee credential',
      description: 'Proof of employment',
      display: [
        {
          lang: 'en',
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

  describe('DID metadata signer', () => {
    it('creates the issuer with a did signer when the DID publishes the key for authentication', async () => {
      findBoundVerificationMethodId.mockResolvedValue(`${AGENT_DID}#openid4vc-issuer`)
      const { api } = await initialized({ issuer: { metadataSigner: 'did' }, issuerMissing: true })
      expect(api.createIssuer).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataSigner: { method: 'did', didUrl: `${AGENT_DID}#openid4vc-issuer` },
        }),
      )
    })

    it('refuses to start when the DID does not publish the signing key for authentication', async () => {
      findBoundVerificationMethodId.mockResolvedValue(null)
      await expect(initialized({ issuer: { metadataSigner: 'did' }, issuerMissing: true })).rejects.toThrow(
        'does not publish the signing key for authentication',
      )
    })

    it('refreshes the did signer on an issuer record that already exists', async () => {
      findBoundVerificationMethodId.mockResolvedValue(`${AGENT_DID}#openid4vc-issuer`)
      const { api } = await initialized({ issuer: { metadataSigner: 'did' } })
      expect(api.createIssuer).not.toHaveBeenCalled()
      expect(api.updateIssuerMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataSigner: { method: 'did', didUrl: `${AGENT_DID}#openid4vc-issuer` },
        }),
      )
    })

    it('refreshes the x5c signer on an issuer record that already exists', async () => {
      const { api } = await initialized({ issuer: { metadataSigner: 'x5c' } })
      expect(api.createIssuer).not.toHaveBeenCalled()
      expect(api.updateIssuerMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataSigner: { method: 'x5c', x5c: [leafCertificate] },
        }),
      )
    })
  })
})
