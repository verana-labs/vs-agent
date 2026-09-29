import { RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionState } from '@credo-ts/openid4vc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminApiErrorCode } from '@verana-labs/vs-agent-sdk'

import { IssuerService } from '../src/services/IssuerService'

import {
  issuanceSession,
  issuanceSessionRepository,
  issuerAgent,
  issuerApi,
  issuerOptions,
  issuerSigningHandle,
  issuerSink,
  stubTypeMetadataFetch,
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

async function initializedIssuer() {
  const api = issuerApi()
  api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
  const service = new IssuerService(issuerAgent(api) as never, issuerOptions(), issuerSink)
  await service.ensureInitialized()
  return { service, api }
}

describe('IssuerService issuance sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubTypeMetadataFetch()
    loadSigningCertificate.mockResolvedValue(issuerSigningHandle())
    publishDevelopmentSigningKey.mockResolvedValue(undefined)
    verifyKeyBoundToDid.mockResolvedValue('bound')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns only safe offer state fields', async () => {
    const { service, api } = await initializedIssuer()
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

    await expect(service.getIssuanceSession('session-id')).resolves.toEqual({
      id: 'session-id',
      jsonSchemaCredentialId: 'employee',
      state: 'OfferCreated',
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
      updatedAt: new Date('2026-07-21T10:00:00.000Z'),
      expiresAt: new Date('2026-07-21T10:05:00.000Z'),
    })
  })

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

  it('leaves the listing filters to the query', async () => {
    const { service } = await initializedIssuer()
    issuanceSessionRepository.findByQuery.mockResolvedValue([])

    await service.listIssuanceSessions({
      jsonSchemaCredentialId: 'badge',
      state: OpenId4VcIssuanceSessionState.Completed,
    })

    expect(issuanceSessionRepository.findByQuery).toHaveBeenLastCalledWith(expect.anything(), {
      issuerId: 'issuer',
      jsonSchemaCredentialId: 'badge',
      state: 'Completed',
    })
  })

  it('deletes a session of this issuer', async () => {
    const { service, api } = await initializedIssuer()
    api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession())

    await service.deleteIssuanceSession('session-1')

    expect(api.deleteIssuanceSessionById).toHaveBeenCalledWith('session-1')
  })

  it('refuses to delete a session of another issuer', async () => {
    const { service, api } = await initializedIssuer()
    api.getIssuanceSessionById.mockResolvedValueOnce(issuanceSession({ issuerId: 'other-issuer' }))

    await expect(service.deleteIssuanceSession('session-1')).rejects.toMatchObject({
      code: AdminApiErrorCode.UnknownId,
    })
    expect(api.deleteIssuanceSessionById).not.toHaveBeenCalled()
  })
})
