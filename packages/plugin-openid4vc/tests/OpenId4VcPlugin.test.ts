import type { OpenId4VcIssuerSink, OpenId4VcPluginOptions } from '../src/types'
import type { IndexerActivity, IndexerHandlerContext, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { IndexerHandlerRegistry, ParticipantRole } from '@verana-labs/vs-agent-sdk'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import { IssuerService } from '../src/services/IssuerService'
import { VerifierService } from '../src/services/VerifierService'
import { OPENID4VC_DID_TRUST_RESOLVER, OPENID4VC_ISSUER_SINK, OPENID4VC_OPTIONS } from '../src/types'

import { OpenId4VcPlugin } from '../src/nestjs/OpenId4VcPlugin'
import { V2OpenId4VcCredentialExchangesController } from '../src/nestjs/V2OpenId4VcCredentialExchangesController'
import { V2OpenId4VcPresentationsController } from '../src/nestjs/V2OpenId4VcPresentationsController'
import { V2OpenId4VcSigningCertificatesController } from '../src/nestjs/V2OpenId4VcSigningCertificatesController'

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  credentialConfigurations: [],
})

const issuerSinkOf = (plugin: VsAgentNestPlugin): OpenId4VcIssuerSink =>
  plugin.providers?.find(provider => provider.provide === OPENID4VC_ISSUER_SINK).useValue

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const AGENT_DID = 'did:web:agent.example'

const activity = (msg: string, entity_id = '7'): IndexerActivity => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  block_height: 42,
  entity_type: 'participant',
  entity_id,
  msg,
  changes: {},
})

const ownIssuerParticipant = { id: 7, schema_id: 1, did: AGENT_DID, role: ParticipantRole.Issuer }

const handlerContext = (participant: Record<string, unknown> = ownIssuerParticipant) =>
  ({
    agent: {
      did: AGENT_DID,
      config: { logger },
      indexer: { getParticipant: vi.fn().mockResolvedValue(participant) },
    },
  }) as unknown as IndexerHandlerContext

const advertising = (credentialSchemaId: number): OpenId4VcPluginOptions => ({
  ...options(),
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: 'https://ecosystem.example/vt/vct/1',
      name: 'Employee credential',
      vtjscId: 'vtjsc:1',
      credentialSchemaId,
      jsonSchema: '{}',
      claims: ['name'],
      disclosureFrame: ['name'],
    },
  ],
})

describe('OpenId4VcPlugin', () => {
  it('registers the three v2 controllers', () => {
    expect(OpenId4VcPlugin(options()).controllers).toEqual([
      V2OpenId4VcCredentialExchangesController,
      V2OpenId4VcPresentationsController,
      V2OpenId4VcSigningCertificatesController,
    ])
  })

  it('hands Nest the options, the issuer sink and both services', () => {
    expect(OpenId4VcPlugin(options()).providers).toEqual([
      { provide: OPENID4VC_OPTIONS, useValue: options() },
      { provide: OPENID4VC_ISSUER_SINK, useValue: expect.any(Function) },
      { provide: OPENID4VC_DID_TRUST_RESOLVER, useValue: expect.any(Function) },
      IssuerService,
      VerifierService,
    ])
  })

  it('exposes the credo modules and the public middleware', () => {
    const plugin = OpenId4VcPlugin(options())

    expect(plugin.name).toBe('openid4vc')
    expect(plugin.credoPlugin?.modules).toHaveProperty('openId4Vc')
    expect(plugin.credoPlugin?.modules).toHaveProperty('x509')
    expect(typeof plugin.publicMiddleware).toBe('function')
  })

  it.each([
    'StartParticipantOP',
    'RenewParticipantOP',
    'SetParticipantOPToValidated',
    'SetParticipantEffectiveUntil',
    'RevokeParticipant',
    'SelfCreateParticipant',
    'CreateRootParticipant',
    'SlashParticipantTrustDeposit',
    'CancelParticipantOPLastRequest',
    'RepayParticipantSlashedTrustDeposit',
  ])('refreshes the configuration set on %s, keeping the original handler', async msg => {
    const plugin = OpenId4VcPlugin(options())
    const original = vi.fn()
    const registry = new IndexerHandlerRegistry()
    registry.register({ msg, handle: original })
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(activity(msg), handlerContext())

    expect(original).toHaveBeenCalledOnce()
    expect(refreshCredentialConfigurations).toHaveBeenCalledWith(undefined)
  })

  it('leaves the configuration set alone for a participant of another agent', async () => {
    const plugin = OpenId4VcPlugin(options())
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(
      activity('StartParticipantOP'),
      handlerContext({ id: 7, schema_id: 9, did: 'did:web:other.example', role: ParticipantRole.Issuer }),
    )

    expect(refreshCredentialConfigurations).not.toHaveBeenCalled()
  })

  it('leaves the configuration set alone for a foreign participant of an advertised schema', async () => {
    const plugin = OpenId4VcPlugin(advertising(9))
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(
      activity('RevokeParticipant'),
      handlerContext({ id: 7, schema_id: 9, did: 'did:web:other.example', role: ParticipantRole.Issuer }),
    )

    expect(refreshCredentialConfigurations).not.toHaveBeenCalled()
  })

  it('leaves the configuration set alone for a participant this agent does not issue under', async () => {
    const plugin = OpenId4VcPlugin(advertising(1))
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(
      activity('RevokeParticipant'),
      handlerContext({ id: 7, schema_id: 1, did: AGENT_DID, role: ParticipantRole.Verifier }),
    )

    expect(refreshCredentialConfigurations).not.toHaveBeenCalled()
  })

  it('leaves the configuration set alone for a CredentialSchema the agent does not advertise', async () => {
    const plugin = OpenId4VcPlugin(options())
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(activity('CreateNewCredentialSchema', '1'), handlerContext())

    expect(refreshCredentialConfigurations).not.toHaveBeenCalled()
  })

  it('names the CredentialSchema an update notification changed, so its document is read again', async () => {
    const plugin = OpenId4VcPlugin(advertising(1))
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(activity('UpdateCredentialSchema', '1'), handlerContext())
    await registry.dispatch(activity('ArchiveCredentialSchema', '1'), handlerContext())

    expect(refreshCredentialConfigurations.mock.calls).toEqual([[1], [undefined]])
  })

  it('leaves the refresh out when the original handler throws', async () => {
    const plugin = OpenId4VcPlugin(options())
    const registry = new IndexerHandlerRegistry()
    registry.register({
      msg: 'RevokeParticipant',
      handle: () => Promise.reject(new Error('the indexer block could not be applied')),
    })
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)

    await expect(registry.dispatch(activity('RevokeParticipant'), handlerContext())).rejects.toThrow(
      'the indexer block could not be applied',
    )
    expect(refreshCredentialConfigurations).not.toHaveBeenCalled()
  })

  it('stays quiet until the issuer published itself and logs a failed refresh', async () => {
    const plugin = OpenId4VcPlugin(options())
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    await registry.dispatch(activity('StartParticipantOP'), handlerContext())
    expect(logger.error).not.toHaveBeenCalled()

    issuerSinkOf(plugin)({
      refreshCredentialConfigurations: () => Promise.reject(new Error('credo refused the metadata')),
    } as never)
    await registry.dispatch(activity('StartParticipantOP'), handlerContext())

    expect(logger.error).toHaveBeenCalledWith(
      '[OpenID4VC] credential configuration refresh failed for StartParticipantOP',
      expect.any(Error),
    )
  })

  it('serves the well-known issuer metadata of the issuer that registered itself', async () => {
    const plugin = OpenId4VcPlugin(options())
    const middleware = plugin.publicMiddleware as never

    expect((await request(middleware).get('/.well-known/jwt-vc-issuer')).status).toBe(500)

    issuerSinkOf(plugin)({ getJwtVcIssuerMetadata: () => ({ issuer: 'https://agent.example' }) } as never)
    const served = await request(middleware).get('/.well-known/jwt-vc-issuer')

    expect(served.status).toBe(200)
    expect(served.body).toEqual({ issuer: 'https://agent.example' })
  })
})
