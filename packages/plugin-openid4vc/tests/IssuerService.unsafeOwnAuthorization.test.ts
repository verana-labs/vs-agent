import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import { IssuerService } from '../src/services/IssuerService'

import {
  contractorConfiguration,
  issuanceSession,
  issuanceSessionRepository,
  issuerAgent,
  issuerApi,
  issuerOptions,
  issuerSigningHandle,
  issuerSink,
  logger,
  stubTypeMetadataFetch,
} from './helpers/issuerServiceFixtures'

const {
  buildCredentialConfigurations,
  resolveCredentialType,
  loadSigningCertificate,
  publishDevelopmentSigningKey,
  verifyKeyBoundToDid,
} = vi.hoisted(() => ({
  buildCredentialConfigurations: vi.fn(),
  resolveCredentialType: vi.fn(),
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
vi.mock('../src/services/credentialConfigurationBuilder', () => ({
  buildCredentialConfigurations,
  resolveCredentialType,
}))

// The demo flag AGENT_UNSAFE_SKIP_OWN_AUTHORIZATION: the issuer offers a credential type although
// it holds no ISSUER Participant for it.
async function issuer(skipsOwnAuthorization: boolean) {
  const api = issuerApi()
  api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
  api.createCredentialOffer.mockResolvedValue({
    credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
    issuanceSession: issuanceSession({ id: 'session-2' }),
  })
  const options = issuerOptions()
  const agent = issuerAgent(api, undefined, undefined, undefined, {
    anonCredsTrust: { assertOwnAuthorization: vi.fn().mockResolvedValue(undefined), skipsOwnAuthorization },
  })
  const service = new IssuerService(agent as never, options, issuerSink)
  await service.ensureInitialized()
  return { service, api, options }
}

const lastAdvertisedIds = (api: ReturnType<typeof issuerApi>) =>
  Object.keys(api.updateIssuerMetadata.mock.calls.at(-1)?.[0].credentialConfigurationsSupported ?? {})

const contractorOffer = { jsonSchemaCredentialId: 'contractor', claims: { name: 'Ada' }, ttlSeconds: 3_600 }

describe('IssuerService with skipsOwnAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubTypeMetadataFetch()
    buildCredentialConfigurations.mockResolvedValue(undefined)
    resolveCredentialType.mockResolvedValue(contractorConfiguration)
    issuanceSessionRepository.findByQuery.mockResolvedValue([])
    loadSigningCertificate.mockResolvedValue(issuerSigningHandle())
    publishDevelopmentSigningKey.mockResolvedValue(undefined)
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('refuses a type outside its ISSUER Participants when the flag is off', async () => {
    const { service } = await issuer(false)

    await expect(service.createOffer(contractorOffer)).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
    expect(resolveCredentialType).not.toHaveBeenCalled()
  })

  it('derives the type from the VTJSC, advertises it and offers it when the flag is on', async () => {
    const { service, api } = await issuer(true)

    await expect(service.createOffer(contractorOffer)).resolves.toMatchObject({
      issuanceSessionId: 'session-2',
    })
    expect(resolveCredentialType).toHaveBeenCalledWith(expect.anything(), 'contractor')
    expect(api.createCredentialOffer).toHaveBeenCalledWith(
      expect.objectContaining({ credentialConfigurationIds: ['contractor'] }),
    )
    expect(lastAdvertisedIds(api)).toEqual(['employee', 'contractor'])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[UNSAFE]'))
  })

  it('keeps the type when a refresh rebuilds the set from the Participants', async () => {
    const { service, options } = await issuer(true)
    await service.createOffer(contractorOffer)

    buildCredentialConfigurations.mockResolvedValue([issuerOptions().credentialConfigurations[0]])
    await service.refreshCredentialConfigurations()

    expect(options.credentialConfigurations.map(configuration => configuration.id)).toEqual([
      'employee',
      'contractor',
    ])
  })

  it('advertises again the types of the existing issuance sessions after a restart', async () => {
    issuanceSessionRepository.findByQuery.mockResolvedValue([issuanceSession({ getTag: () => 'contractor' })])

    const { api } = await issuer(true)

    expect(lastAdvertisedIds(api)).toEqual(['employee', 'contractor'])
  })
})
