import { RecordNotFoundError } from '@credo-ts/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IssuerService } from '../src/services/IssuerService'

import {
  AGENT_DID,
  contractorConfiguration,
  issuerAgent,
  issuerApi,
  issuerOptions,
  issuerSigningHandle,
  issuerSink,
  jwsService,
  leafCertificate,
  logger,
  PUBLIC_JWK,
  stubTypeMetadataFetch,
} from './helpers/issuerServiceFixtures'

const {
  buildCredentialConfigurations,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  verifyKeyBoundToDid,
} = vi.hoisted(() => ({
  buildCredentialConfigurations: vi.fn(),
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
vi.mock('../src/services/credentialConfigurationBuilder', () => ({ buildCredentialConfigurations }))

describe('IssuerService initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubTypeMetadataFetch()
    buildCredentialConfigurations.mockResolvedValue(undefined)
    loadSigningCertificate.mockResolvedValue(issuerSigningHandle())
    publishDevelopmentSigningKey.mockResolvedValue(undefined)
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('initializes once on the Nest module hook and publishes itself to the SDK plugin', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

    await service.onModuleInit()
    await service.onModuleInit()

    expect(loadSigningCertificate).toHaveBeenCalledOnce()
    expect(issuerSink).toHaveBeenCalledWith(service)
    expect(service.getJwtVcIssuerMetadata()).toEqual({
      issuer: 'https://agent.example',
      jwks: { keys: [PUBLIC_JWK] },
    })
  })

  it('advertises the rebuilt set on a refresh', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const options = issuerOptions()
    const service = new IssuerService(issuerAgent(api) as never, options, issuerSink)
    await service.onModuleInit()

    buildCredentialConfigurations.mockResolvedValue([contractorConfiguration])
    await service.refreshCredentialConfigurations()

    expect(options.credentialConfigurations).toEqual([contractorConfiguration])
  })

  it('re-renders the issuer metadata on a refresh', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)
    await service.onModuleInit()
    expect(Object.keys(api.updateIssuerMetadata.mock.calls[0][0].credentialConfigurationsSupported)).toEqual([
      'employee',
    ])

    buildCredentialConfigurations.mockResolvedValue([contractorConfiguration])
    await service.refreshCredentialConfigurations()

    expect(Object.keys(api.updateIssuerMetadata.mock.calls[1][0].credentialConfigurationsSupported)).toEqual([
      'contractor',
    ])
  })

  it('surfaces the failure a re-render raised', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)
    await service.onModuleInit()

    buildCredentialConfigurations.mockResolvedValue([contractorConfiguration])
    api.updateIssuerMetadata.mockRejectedValueOnce(new Error('credo refused the metadata'))

    await expect(service.refreshCredentialConfigurations()).rejects.toThrow('credo refused the metadata')
  })

  it('keeps the advertised set when the re-render fails', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const options = issuerOptions()
    const previous = options.credentialConfigurations
    const service = new IssuerService(issuerAgent(api) as never, options, issuerSink)
    await service.onModuleInit()

    buildCredentialConfigurations.mockResolvedValue([contractorConfiguration])
    api.updateIssuerMetadata.mockRejectedValueOnce(new Error('credo refused the metadata'))

    await expect(service.refreshCredentialConfigurations()).rejects.toThrow()
    expect(options.credentialConfigurations).toBe(previous)
  })

  it('leaves the served metadata alone when the rebuilt set equals the current one', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const options = issuerOptions()
    const service = new IssuerService(issuerAgent(api) as never, options, issuerSink)
    await service.onModuleInit()

    buildCredentialConfigurations.mockResolvedValue(issuerOptions().credentialConfigurations)
    await service.refreshCredentialConfigurations()

    expect(api.updateIssuerMetadata).toHaveBeenCalledOnce()
  })

  it('keeps the last known set when the rebuild fails', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const options = issuerOptions()
    const service = new IssuerService(issuerAgent(api) as never, options, issuerSink)
    await service.onModuleInit()

    buildCredentialConfigurations.mockRejectedValue(new Error('the indexer refused the Participant list'))
    await service.refreshCredentialConfigurations()

    expect(options.credentialConfigurations.map(configuration => configuration.id)).toEqual(['employee'])
    expect(api.updateIssuerMetadata).toHaveBeenCalledOnce()
  })

  it('says the set kept its last known contents when the rebuild fails', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)
    await service.onModuleInit()

    buildCredentialConfigurations.mockRejectedValue(new Error('the indexer refused the Participant list'))
    await service.refreshCredentialConfigurations()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('keeps its last known contents'))
  })

  it('applies a refresh that arrives while the initialization still runs', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const options = issuerOptions()
    const service = new IssuerService(issuerAgent(api) as never, options, issuerSink)
    let refreshed: Promise<void> | undefined
    buildCredentialConfigurations.mockImplementationOnce(async () => {
      buildCredentialConfigurations.mockResolvedValue([contractorConfiguration])
      refreshed = service.refreshCredentialConfigurations()
      return undefined
    })

    await service.ensureInitialized()
    await refreshed

    expect(options.credentialConfigurations).toEqual([contractorConfiguration])
    expect(
      Object.keys(api.updateIssuerMetadata.mock.lastCall?.[0].credentialConfigurationsSupported),
    ).toEqual(['contractor'])
  })

  it('leaves a refresh alone rather than driving the issuer initialization', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

    await service.refreshCredentialConfigurations()

    expect(loadSigningCertificate).not.toHaveBeenCalled()
    expect(api.updateIssuerMetadata).not.toHaveBeenCalled()
  })

  it('logs the certificate mode and the published verification method at startup', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    loadSigningCertificate.mockResolvedValue({ ...issuerSigningHandle(), development: true })
    publishDevelopmentSigningKey.mockResolvedValue(`${AGENT_DID}#openid4vc-development-issuer`)

    await new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink).ensureInitialized()

    expect(logger.info).toHaveBeenCalledWith(
      '[OpenID4VC] issuer signs with a development certificate, ' +
        `published as ${AGENT_DID}#openid4vc-development-issuer`,
    )
  })

  it('initializes the issuer on the first certificate read', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

    await expect(service.getCertificateInfo()).resolves.toMatchObject({
      role: 'issuer',
      development: false,
    })
    expect(loadSigningCertificate).toHaveBeenCalledOnce()
  })

  it('puts attestation on the record wherever a key-attestation root is configured', async () => {
    const withRoot = issuerApi()
    withRoot.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const configured = issuerOptions()
    if (!configured.issuer) throw new Error('issuer options missing')
    configured.issuer.keyAttestationCertificates = ['wallet-provider-root']

    await new IssuerService(issuerAgent(withRoot) as never, configured, issuerSink).ensureInitialized()

    const proofTypes =
      withRoot.createIssuer.mock.calls[0][0].credentialConfigurationsSupported.employee.proof_types_supported
    expect(Object.keys(proofTypes).sort()).toEqual(['attestation', 'jwt'])
    expect(proofTypes.attestation).toEqual({
      proof_signing_alg_values_supported: ['ES256'],
      key_attestations_required: {},
    })
    expect(proofTypes.jwt.key_attestations_required).toEqual({})
  })

  it('leaves attestation and the key-attestation requirement off without a root', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )

    await new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink).ensureInitialized()

    const proofTypes =
      api.createIssuer.mock.calls[0][0].credentialConfigurationsSupported.employee.proof_types_supported
    expect(Object.keys(proofTypes)).toEqual(['jwt'])
    expect(proofTypes.jwt).toEqual({ proof_signing_alg_values_supported: ['ES256'] })
  })

  it('advertises the client attestation algorithms only with a wallet attestation root', async () => {
    const withRoot = issuerApi()
    withRoot.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    const configured = issuerOptions()
    if (!configured.issuer) throw new Error('issuer options missing')
    configured.issuer.walletAttestationCertificates = ['wallet-provider-root']
    const plain = issuerApi()
    plain.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
    await new IssuerService(issuerAgent(plain) as never, issuerOptions(), issuerSink).ensureInitialized()

    await new IssuerService(issuerAgent(withRoot) as never, configured, issuerSink).ensureInitialized()

    expect(withRoot.updateIssuerMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        dpopSigningAlgValuesSupported: ['ES256'],
        clientAttestationSigningAlgValuesSupported: ['ES256'],
        clientAttestationPopSigningAlgValuesSupported: ['ES256'],
      }),
    )
    const withoutRoot = plain.updateIssuerMetadata.mock.calls[0][0]
    expect(withoutRoot.dpopSigningAlgValuesSupported).toEqual(['ES256'])
    expect(withoutRoot).not.toHaveProperty('clientAttestationSigningAlgValuesSupported')
    expect(withoutRoot).not.toHaveProperty('clientAttestationPopSigningAlgValuesSupported')
  })

  it('creates the configured issuer with only dc+sd-jwt, ES256, and JWK holder binding', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(
      new RecordNotFoundError('issuer not found', { recordType: 'OpenId4VcIssuerRecord' }),
    )
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

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
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

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
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

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
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)
    loadSigningCertificate.mockRejectedValueOnce(new Error('storage not ready'))

    await expect(service.ensureInitialized()).rejects.toThrow('storage not ready')
    await service.ensureInitialized()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
  })

  it('requires an agent DID before loading signing material', async () => {
    const agentWithoutDid = { ...issuerAgent(), did: undefined }
    const service = new IssuerService(agentWithoutDid as never, issuerOptions(), issuerSink)

    await expect(service.ensureInitialized()).rejects.toThrow('agent DID')
    expect(loadSigningCertificate).not.toHaveBeenCalled()
  })

  it('rejects a signing certificate whose DID does not match the agent DID', async () => {
    loadSigningCertificate.mockResolvedValue({
      ...issuerSigningHandle(),
      certificate: { ...leafCertificate, sanUriNames: ['did:example:attacker'] },
    })
    const service = new IssuerService(issuerAgent() as never, issuerOptions(), issuerSink)

    await expect(service.ensureInitialized()).rejects.toThrow('does not match the agent DID')
    expect(verifyKeyBoundToDid).not.toHaveBeenCalled()
  })

  it.each([
    ['unresolvable', 'could not be resolved'],
    ['unbound', 'assertionMethod'],
  ] as const)('fails initialization for %s DID key binding', async (binding, message) => {
    verifyKeyBoundToDid.mockResolvedValue(binding)
    const service = new IssuerService(issuerAgent() as never, issuerOptions(), issuerSink)

    await expect(service.ensureInitialized()).rejects.toThrow(message)
  })

  it('does not treat an issuer lookup failure as a missing issuer', async () => {
    const api = issuerApi()
    api.getIssuerByIssuerId.mockRejectedValue(new Error('storage unavailable'))
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)

    await expect(service.ensureInitialized()).rejects.toThrow('storage unavailable')
    expect(api.createIssuer).not.toHaveBeenCalled()
  })

  describe('ECS service display', () => {
    it('publishes the ECS Service name and logo in the issuer metadata', async () => {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockRejectedValue(new RecordNotFoundError('missing', { recordType: 'issuer' }))
      const ecsClaims = { service: { name: 'Verana Demo', logoUri: 'https://agent.example/logo.svg' } }

      await new IssuerService(
        issuerAgent(api, AGENT_DID, jwsService(), ecsClaims) as never,
        issuerOptions(),
        issuerSink,
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
        issuerSink,
      ).ensureInitialized()

      expect(api.createIssuer.mock.calls[0][0]).not.toHaveProperty('display')
    })

    it('omits the logo when the ECS Service claim carries no logo URI', async () => {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockRejectedValue(new RecordNotFoundError('missing', { recordType: 'issuer' }))

      await new IssuerService(
        issuerAgent(api, AGENT_DID, jwsService(), { service: { name: 'Verana Demo' } }) as never,
        issuerOptions(),
        issuerSink,
      ).ensureInitialized()

      expect(api.createIssuer).toHaveBeenCalledWith(
        expect.objectContaining({ display: [{ name: 'Verana Demo', locale: 'en' }] }),
      )
    })

    it('refreshes the x5c signer on an issuer record that already exists', async () => {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })

      await new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink).ensureInitialized()

      expect(api.createIssuer).not.toHaveBeenCalled()
      expect(api.updateIssuerMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataSigner: { method: 'x5c', x5c: [leafCertificate] },
        }),
      )
    })
  })
})
