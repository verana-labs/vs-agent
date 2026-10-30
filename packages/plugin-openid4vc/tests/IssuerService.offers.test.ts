import { ClaimFormat } from '@credo-ts/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AdminApiError,
  AdminApiErrorCode,
  AnonCredsTrustError,
  AnonCredsTrustErrorReason,
  AnonCredsTrustService,
  digestOfBytes,
  ParticipantRole,
} from '@verana-labs/vs-agent-sdk'

import { IssuerService } from '../src/services/IssuerService'

import {
  anonCredsTrust,
  credentialRequest,
  EMPLOYEE_VCT,
  HOLDER_JWK,
  issuanceSession,
  issuanceSessionRepository,
  issuerAgent,
  issuerApi,
  issuerOptions,
  issuerSigningHandle,
  issuerSink,
  leafCertificate,
  servedTypeMetadata,
  stampedIntegrity,
  stubTypeMetadataFetch,
  TYPE_METADATA,
  TYPE_METADATA_INTEGRITY,
} from './helpers/issuerServiceFixtures'

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

let typeMetadataFetch: ReturnType<typeof stubTypeMetadataFetch>

/** The status list service as the offers see it: an index is bound, completed or released. */
function statusLists() {
  return {
    attachIssuer: vi.fn(),
    bindIndex: vi.fn(
      async ({ statusListId, statusListIndex }: { statusListId: string; statusListIndex: number }) => ({
        statusListId,
        statusListIndex,
        uri: `https://agent.example/oid4vc/status-list/${statusListId}`,
      }),
    ),
    completeBinding: vi.fn(async () => {}),
    releaseIndex: vi.fn(async () => {}),
    recordIssuance: vi.fn(async () => {}),
    getStatusListToken: vi.fn(async () => undefined),
  }
}

async function initializedIssuer(agentOverrides: Record<string, unknown> = {}, lists = statusLists()) {
  const api = issuerApi()
  api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
  const options = issuerOptions()
  const agent = issuerAgent(api, undefined, undefined, undefined, agentOverrides) as Record<string, unknown>
  const service = new IssuerService(agent as never, options, issuerSink, lists as never)
  await service.ensureInitialized()
  return { service, api, options, agent, lists }
}

const offer = { jsonSchemaCredentialId: 'employee', claims: { name: 'Ada' }, ttlSeconds: 3_600 }

describe('IssuerService credential offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    typeMetadataFetch = stubTypeMetadataFetch()
    anonCredsTrust.assertOwnAuthorization.mockResolvedValue(undefined)
    loadSigningCertificate.mockResolvedValue(issuerSigningHandle())
    publishDevelopmentSigningKey.mockResolvedValue(undefined)
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('fails credential mapping clearly before initialization', async () => {
    const service = new IssuerService(issuerAgent() as never, issuerOptions(), issuerSink)

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
    const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)
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
    const { service, api } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({
        id: 'session-id',
        state: 'OfferCreated',
        createdAt: new Date('2026-07-21T10:00:00.000Z'),
        expiresAt: new Date('2026-07-21T10:05:00.000Z'),
      }),
    })

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
    const { service, api } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })

    await service.createOffer(offer)

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
    const { service, api } = await initializedIssuer()

    await expect(
      service.createOffer({ jsonSchemaCredentialId: 'employee', claims, ttlSeconds: 3_600 }),
    ).rejects.toThrow(message)
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it.each([
    [AnonCredsTrustErrorReason.Unavailable, AdminApiErrorCode.ResolverUnavailable, 503],
    [AnonCredsTrustErrorReason.NotAuthorized, AdminApiErrorCode.NotAuthorized, 409],
  ])('maps the %s trust decision of the agent participant onto %s', async (reason, code, status) => {
    const { service, api } = await initializedIssuer()
    anonCredsTrust.assertOwnAuthorization.mockRejectedValueOnce(
      new AnonCredsTrustError(reason, 'the indexer refused the Participant lookup'),
    )

    await expect(service.createOffer(offer)).rejects.toMatchObject({ code, status })
    expect(anonCredsTrust.assertOwnAuthorization).toHaveBeenCalledWith({
      role: ParticipantRole.Issuer,
      credentialSchemaId: 1,
    })
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('refuses the offer when the indexer lists no active ISSUER Participant of the schema', async () => {
    const listParticipants = vi.fn().mockResolvedValue([])
    const { service, api, agent } = await initializedIssuer({ indexer: { listParticipants } })
    agent.anonCredsTrust = new AnonCredsTrustService(agent as never)

    await expect(service.createOffer(offer)).rejects.toMatchObject({
      code: AdminApiErrorCode.NotAuthorized,
      status: 409,
    })
    expect(listParticipants).toHaveBeenCalledWith({
      did: 'did:web:agent.example',
      role: ParticipantRole.Issuer,
      schemaId: 1,
      participantState: 'ACTIVE',
    })
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('answers an unreadable Type Metadata document with the unavailable resolver code', async () => {
    const { service, api } = await initializedIssuer()
    typeMetadataFetch.mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' }))

    await expect(service.createOffer(offer)).rejects.toMatchObject({
      code: AdminApiErrorCode.ResolverUnavailable,
      status: 503,
    })
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('reads the Type Metadata once for an offer, then reuses it for the credential', async () => {
    const { service, api } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })

    await service.createOffer(offer)
    await service.mapCredentialRequest(credentialRequest() as never)

    expect(typeMetadataFetch).toHaveBeenCalledOnce()
  })

  it('reads the Type Metadata under the bounded fetch', async () => {
    const { service, api } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })

    await service.createOffer(offer)

    expect(typeMetadataFetch).toHaveBeenCalledWith(EMPLOYEE_VCT, {
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    })
  })

  it('re-reads the document of the CredentialSchema an update notification named', async () => {
    const { service } = await initializedIssuer()
    expect(await stampedIntegrity(service, credentialRequest())).toBe(TYPE_METADATA_INTEGRITY)

    const updated = JSON.stringify({ vct: EMPLOYEE_VCT, name: 'renamed' })
    typeMetadataFetch.mockImplementation(async () => servedTypeMetadata(updated))
    await service.refreshCredentialConfigurations(1)

    expect(await stampedIntegrity(service, credentialRequest())).toBe(digestOfBytes(updated))
  })

  it('keeps the cached document of a CredentialSchema the notification did not name', async () => {
    const { service } = await initializedIssuer()
    expect(await stampedIntegrity(service, credentialRequest())).toBe(TYPE_METADATA_INTEGRITY)

    typeMetadataFetch.mockImplementation(async () =>
      servedTypeMetadata(JSON.stringify({ vct: EMPLOYEE_VCT, name: 'renamed' })),
    )
    await service.refreshCredentialConfigurations(2)

    expect(await stampedIntegrity(service, credentialRequest())).toBe(TYPE_METADATA_INTEGRITY)
    expect(typeMetadataFetch).toHaveBeenCalledOnce()
  })

  it('answers a claim value the json_schema rejects as invalid input, with the violations', async () => {
    const { service, api } = await initializedIssuer()

    await expect(
      service.createOffer({
        jsonSchemaCredentialId: 'employee',
        claims: { role: 'engineer' },
        ttlSeconds: 3_600,
      }),
    ).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
      status: 400,
      details: { violations: [{ path: '', message: "must have required property 'name'" }] },
    })
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it.each([59, 7_776_001, '3600', undefined])('rejects an offer lifetime of %s', async ttlSeconds => {
    const { service, api } = await initializedIssuer()

    await expect(
      service.createOffer({ jsonSchemaCredentialId: 'employee', claims: { name: 'Ada' }, ttlSeconds }),
    ).rejects.toThrow('ttlSeconds')
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('maps validated claims to one short-lived dc+sd-jwt credential per JWK holder key', async () => {
    const { service } = await initializedIssuer()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'))

    const mapped = await service.mapCredentialRequest(
      credentialRequest({ name: 'Ada', role: 'engineer' }) as never,
    )

    expect(mapped).toEqual({
      type: 'credentials',
      format: ClaimFormat.SdJwtDc,
      credentials: [
        {
          payload: {
            vct: EMPLOYEE_VCT,
            'vct#integrity': TYPE_METADATA_INTEGRITY,
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

  it('refuses stored offer metadata that carries a reserved envelope claim', async () => {
    const { service, options } = await initializedIssuer()
    options.credentialConfigurations[0].claims.push('exp')

    await expect(
      service.mapCredentialRequest(credentialRequest({ name: 'Ada', role: 'engineer', exp: 1 }) as never),
    ).rejects.toThrow("claim 'exp' is reserved by SD-JWT VC")
  })

  it('preserves a verified DID holder binding supplied by Credo', async () => {
    const { service } = await initializedIssuer()

    const mapped = await service.mapCredentialRequest({
      ...credentialRequest({ name: 'Ada', role: 'engineer' }),
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
    const { service } = await initializedIssuer()

    await expect(
      service.mapCredentialRequest({
        credentialConfigurationId: 'employee',
        issuanceSession: { issuanceMetadata },
        holderBinding: { bindingMethod: 'jwk', proofType: 'jwt', keys: [] },
      } as never),
    ).rejects.toThrow(message)
  })

  it('digests the bytes the Type Metadata URL served, never a re-encoding of them', async () => {
    const withBom = Buffer.from(`﻿${TYPE_METADATA}`, 'utf8')
    const { service } = await initializedIssuer()
    typeMetadataFetch.mockImplementation(async () => servedTypeMetadata(withBom))

    expect(await stampedIntegrity(service, credentialRequest())).toBe(digestOfBytes(withBom))
  })

  it('rejects half a status list pair as invalid input', async () => {
    const { service } = await initializedIssuer()

    await expect(service.createOffer({ ...offer, statusListIndex: 0 })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
    })
    await expect(service.createOffer({ ...offer, statusListId: 'list-1' })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
    })
  })

  it('passes a status list the agent does not host through as an unknown id, before any offer exists', async () => {
    const lists = statusLists()
    lists.bindIndex.mockRejectedValue(
      new AdminApiError(AdminApiErrorCode.UnknownId, 404, 'no status list with id "list-1"'),
    )
    const { service, api } = await initializedIssuer({}, lists)

    await expect(
      service.createOffer({ ...offer, statusListId: 'list-1', statusListIndex: 0 }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.UnknownId })
    expect(api.createCredentialOffer).not.toHaveBeenCalled()
  })

  it('binds the index before the offer, stores the coordinates on the session, and completes the binding', async () => {
    const { service, api, lists } = await initializedIssuer()
    const session = issuanceSession({
      id: 'session-id',
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
    })
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: session,
    })

    await service.createOffer({
      ...offer,
      ttlSeconds: 31_536_000,
      statusListId: 'list-1',
      statusListIndex: 42,
    })

    expect(lists.bindIndex).toHaveBeenCalledWith({ statusListId: 'list-1', statusListIndex: 42 })
    expect(lists.bindIndex.mock.invocationCallOrder[0]).toBeLessThan(
      api.createCredentialOffer.mock.invocationCallOrder[0],
    )
    expect(api.createCredentialOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        issuanceMetadata: {
          claims: { name: 'Ada' },
          ttlSeconds: 31_536_000,
          status: {
            statusListId: 'list-1',
            statusListIndex: 42,
            uri: 'https://agent.example/oid4vc/status-list/list-1',
          },
        },
      }),
    )
    expect(session.getTag('statusListId')).toBe('list-1')
    expect(session.getTag('statusListIndex')).toBe('42')
    // an offer that no wallet redeemed binds its index while the offer is valid
    expect(lists.completeBinding).toHaveBeenCalledWith(
      { statusListId: 'list-1', statusListIndex: 42, uri: 'https://agent.example/oid4vc/status-list/list-1' },
      { issuanceSessionId: 'session-id', expiresAt: new Date('2026-07-21T10:05:00.000Z') },
    )
    expect(lists.releaseIndex).not.toHaveBeenCalled()
  })

  it('releases the index when the offer cannot be created', async () => {
    const { service, api, lists } = await initializedIssuer()
    api.createCredentialOffer.mockRejectedValue(new Error('credo refused the offer'))

    await expect(
      service.createOffer({ ...offer, statusListId: 'list-1', statusListIndex: 42 }),
    ).rejects.toThrow('credo refused the offer')

    expect(lists.releaseIndex).toHaveBeenCalledWith({
      statusListId: 'list-1',
      statusListIndex: 42,
      uri: 'https://agent.example/oid4vc/status-list/list-1',
    })
    expect(lists.completeBinding).not.toHaveBeenCalled()
    expect(api.deleteIssuanceSessionById).not.toHaveBeenCalled()
  })

  it('deletes the session, then releases the index, when the binding cannot be completed', async () => {
    const { service, api, lists } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })
    lists.completeBinding.mockRejectedValue(new Error('storage down'))

    await expect(
      service.createOffer({ ...offer, statusListId: 'list-1', statusListIndex: 42 }),
    ).rejects.toThrow('storage down')

    expect(api.deleteIssuanceSessionById).toHaveBeenCalledWith('session-id')
    expect(lists.releaseIndex).toHaveBeenCalledWith(expect.objectContaining({ statusListIndex: 42 }))
    expect(api.deleteIssuanceSessionById.mock.invocationCallOrder[0]).toBeLessThan(
      lists.releaseIndex.mock.invocationCallOrder[0],
    )
  })

  it('keeps the index bound while a session that names it survives a failed offer', async () => {
    const { service, api, lists } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })
    lists.completeBinding.mockRejectedValue(new Error('storage down'))
    api.deleteIssuanceSessionById.mockRejectedValue(new Error('still down'))

    await expect(
      service.createOffer({ ...offer, statusListId: 'list-1', statusListIndex: 42 }),
    ).rejects.toThrow('storage down')

    expect(api.deleteIssuanceSessionById).toHaveBeenCalledWith('session-id')
    expect(lists.releaseIndex).not.toHaveBeenCalled()
  })

  it('allows a one-year lifetime for a registered credential alone', async () => {
    const { service, api, lists } = await initializedIssuer()
    api.createCredentialOffer.mockResolvedValue({
      credentialOffer: 'openid-credential-offer://?credential_offer_uri=secret',
      issuanceSession: issuanceSession({ id: 'session-id' }),
    })

    await expect(service.createOffer({ ...offer, ttlSeconds: 31_536_000 })).rejects.toMatchObject({
      code: AdminApiErrorCode.InvalidInput,
    })
    expect(lists.bindIndex).not.toHaveBeenCalled()
    await expect(
      service.createOffer({ ...offer, ttlSeconds: 31_536_001, statusListId: 'list-1', statusListIndex: 0 }),
    ).rejects.toMatchObject({ code: AdminApiErrorCode.InvalidInput })
    expect(lists.bindIndex).not.toHaveBeenCalled()
    await expect(
      service.createOffer({ ...offer, ttlSeconds: 31_536_000, statusListId: 'list-1', statusListIndex: 0 }),
    ).resolves.toMatchObject({ issuanceSessionId: 'session-id' })
  })

  it('stamps the same status claim on every copy of a registered credential and records the issuance', async () => {
    const { service, lists } = await initializedIssuer()
    const status = {
      statusListId: 'list-1',
      statusListIndex: 42,
      uri: 'https://agent.example/oid4vc/status-list/list-1',
    }
    const request = {
      ...credentialRequest(),
      issuanceSession: { issuanceMetadata: { claims: { name: 'Ada' }, ttlSeconds: 3_600, status } },
      holderBinding: {
        bindingMethod: 'jwk',
        proofType: 'jwt',
        keys: [
          { method: 'jwk', jwk: HOLDER_JWK },
          { method: 'jwk', jwk: { ...HOLDER_JWK, x: 'another' } },
        ],
      },
    }

    const mapped = await service.mapCredentialRequest(request as never)
    if (mapped.type !== 'credentials') throw new Error('expected credentials')

    expect(mapped.credentials).toHaveLength(2)
    for (const credential of mapped.credentials) {
      if (!('payload' in credential)) throw new Error('expected SD-JWT credentials')
      expect(credential.payload.status).toEqual({ status_list: { idx: 42, uri: status.uri } })
      expect(credential.payload).toMatchObject({ name: 'Ada', vct: EMPLOYEE_VCT })
    }
    const [first] = mapped.credentials
    if (!('payload' in first)) throw new Error('expected SD-JWT credentials')
    expect(lists.recordIssuance).toHaveBeenCalledWith(status, new Date(Number(first.payload.exp) * 1_000))
  })

  it('stamps no status claim on a credential that no list registers', async () => {
    const { service, lists } = await initializedIssuer()

    const mapped = await service.mapCredentialRequest(credentialRequest() as never)
    if (mapped.type !== 'credentials') throw new Error('expected credentials')

    const [credential] = mapped.credentials
    if (!('payload' in credential)) throw new Error('expected SD-JWT credentials')
    expect(credential.payload).not.toHaveProperty('status')
    expect(lists.recordIssuance).not.toHaveBeenCalled()
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
