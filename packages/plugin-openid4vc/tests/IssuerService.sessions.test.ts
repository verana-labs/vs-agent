import { RecordNotFoundError } from '@credo-ts/core'
import { OpenId4VcIssuanceSessionState, OpenId4VcIssuerEvents } from '@credo-ts/openid4vc'
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
  logger,
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

  it('reports the status list coordinates that the offer stored on the session', async () => {
    const { service, api } = await initializedIssuer()
    const session = issuanceSession()
    session.setTag('statusListId', 'list-1')
    session.setTag('statusListIndex', '42')
    api.getIssuanceSessionById.mockResolvedValue(session)

    await expect(service.getIssuanceSession('session-1')).resolves.toMatchObject({
      statusListId: 'list-1',
      statusListIndex: 42,
    })
  })

  it('filters the listing by the status list that the offer named', async () => {
    const { service } = await initializedIssuer()
    issuanceSessionRepository.findByQuery.mockResolvedValue([])

    await service.listIssuanceSessions({ statusListId: 'list-1' })

    expect(issuanceSessionRepository.findByQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ issuerId: 'issuer', statusListId: 'list-1' }),
    )
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

  describe('state events', () => {
    async function listeningIssuer() {
      const api = issuerApi()
      api.getIssuerByIssuerId.mockResolvedValue({ issuerId: 'issuer' })
      const agent = issuerAgent(api)
      await new IssuerService(agent as never, issuerOptions(), issuerSink).onModuleInit()
      const [, listener] =
        agent.events.on.mock.calls.find(
          ([type]) => type === OpenId4VcIssuerEvents.IssuanceSessionStateChanged,
        ) ?? []
      return {
        fire: (issuanceSession: unknown, previousState: string | null) =>
          listener({ payload: { issuanceSession, previousState } }),
        emitted: () => agent.events.emit.mock.calls.map(([, event]) => event.payload),
      }
    }

    it('announces a failed session with its error and nothing of the offer content', async () => {
      const { fire, emitted } = await listeningIssuer()

      fire(
        issuanceSession({
          state: 'Error',
          errorMessage: 'invalid proof',
          preAuthorizedCode: 'secret-code',
          issuanceMetadata: { name: 'Ada', role: 'engineer' },
          credentialOfferPayload: { credential_configuration_ids: ['employee'], grants: { secret: true } },
        }),
        'CredentialRequestReceived',
      )

      await vi.waitFor(() => expect(emitted()).toHaveLength(1))
      expect(emitted()[0]).toEqual({
        type: 'openid4vc.credential-exchanges.state-updated',
        data: {
          credentialExchangeId: 'session-1',
          jsonSchemaCredentialId: 'employee',
          state: 'Error',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2026-01-01T01:00:00.000Z'),
          errorMessage: 'invalid proof',
          previousState: 'CredentialRequestReceived',
        },
      })
    })

    it('ignores the sessions of another issuer, and the creation that createOffer announces', async () => {
      const { fire, emitted } = await listeningIssuer()

      fire(issuanceSession({ issuerId: 'other-issuer', state: 'Completed' }), 'CredentialRequestReceived')
      fire(issuanceSession(), null)
      await new Promise(resolve => setImmediate(resolve))

      expect(emitted()).toEqual([])
    })

    it('logs a session it cannot map instead of throwing into the credo state update', async () => {
      const { fire, emitted } = await listeningIssuer()
      const unreadable = issuanceSession({
        getTag: () => {
          throw new Error('unreadable tag')
        },
      })

      expect(() => fire(unreadable, 'OfferCreated')).not.toThrow()

      await vi.waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'event openid4vc.credential-exchanges.state-updated emission failed',
          expect.objectContaining({ cause: expect.any(Error) }),
        ),
      )
      expect(emitted()).toEqual([])
    })
  })
})
