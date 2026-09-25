import type { OpenId4VcIssuerSink, OpenId4VcPluginOptions } from '../src/types'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import request from 'supertest'
import { describe, expect, it } from 'vitest'

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
