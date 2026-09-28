import type { OpenId4VcIssuerSink, OpenId4VcPluginOptions } from '../src/types'
import type { IndexerActivity, IndexerHandlerContext, VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { IndexerHandlerRegistry } from '@verana-labs/vs-agent-sdk'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import { IssuerService } from '../src/services/IssuerService'
import { VerifierService } from '../src/services/VerifierService'
import { OPENID4VC_ISSUER_SINK, OPENID4VC_OPTIONS } from '../src/types'

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

const participantActivity = (msg: string): IndexerActivity => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  block_height: 42,
  entity_type: 'participant',
  entity_id: '7',
  msg,
  changes: {},
})

const handlerContext = () => ({ agent: { config: { logger } } }) as unknown as IndexerHandlerContext

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

  it('refreshes the configuration set on a Participant notification, keeping the original handler', async () => {
    const plugin = OpenId4VcPlugin(options())
    const original = vi.fn()
    const registry = new IndexerHandlerRegistry()
    registry.register({ msg: 'StartParticipantOP', handle: original })
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)
    await registry.dispatch(participantActivity('StartParticipantOP'), handlerContext())

    expect(original).toHaveBeenCalledOnce()
    expect(refreshCredentialConfigurations).toHaveBeenCalledOnce()
  })

  it('refreshes the configuration set even when the original handler throws', async () => {
    const plugin = OpenId4VcPlugin(options())
    const registry = new IndexerHandlerRegistry()
    registry.register({
      msg: 'RevokeParticipant',
      handle: () => Promise.reject(new Error('the indexer block could not be applied')),
    })
    plugin.registerIndexerHandlers?.(registry)

    const refreshCredentialConfigurations = vi.fn().mockResolvedValue(undefined)
    issuerSinkOf(plugin)({ refreshCredentialConfigurations } as never)

    await expect(
      registry.dispatch(participantActivity('RevokeParticipant'), handlerContext()),
    ).rejects.toThrow('the indexer block could not be applied')
    expect(refreshCredentialConfigurations).toHaveBeenCalledOnce()
  })

  it('stays quiet until the issuer published itself and logs a failed refresh', async () => {
    const plugin = OpenId4VcPlugin(options())
    const registry = new IndexerHandlerRegistry()
    plugin.registerIndexerHandlers?.(registry)

    await registry.dispatch(participantActivity('CreateNewCredentialSchema'), handlerContext())
    expect(logger.error).not.toHaveBeenCalled()

    issuerSinkOf(plugin)({
      refreshCredentialConfigurations: () => Promise.reject(new Error('credo refused the metadata')),
    } as never)
    await registry.dispatch(participantActivity('CreateNewCredentialSchema'), handlerContext())

    expect(logger.error).toHaveBeenCalledWith(
      '[OpenID4VC] credential configuration refresh failed for CreateNewCredentialSchema',
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
