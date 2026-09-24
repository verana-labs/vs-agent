import type { OpenId4VcPluginOptions } from '../src/types'

import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { publishIssuerService } from '../src/services/issuerHolder'
import { IssuerService } from '../src/services/IssuerService'
import { VerifierService } from '../src/services/VerifierService'
import { OPENID4VC_OPTIONS } from '../src/types'

import { OpenId4VcPlugin } from '../src/nestjs/OpenId4VcPlugin'
import { V2Openid4vcCredentialExchangesController } from '../src/nestjs/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../src/nestjs/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../src/nestjs/V2Openid4vcSigningCertificatesController'

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  credentialConfigurations: [],
})

describe('OpenId4VcPlugin', () => {
  it('registers the three v2 controllers', () => {
    expect(OpenId4VcPlugin(options()).controllers).toEqual([
      V2Openid4vcCredentialExchangesController,
      V2Openid4vcPresentationsController,
      V2Openid4vcSigningCertificatesController,
    ])
  })

  it('hands Nest the options and both services from a file that declares no capability', () => {
    expect(OpenId4VcPlugin(options()).providers).toEqual([
      { provide: OPENID4VC_OPTIONS, useValue: options() },
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
    expect(plugin.initialize).toBeUndefined()
  })

  it('serves the well-known issuer metadata of the issuer that registered itself', async () => {
    const middleware = OpenId4VcPlugin(options()).publicMiddleware as never

    expect((await request(middleware).get('/.well-known/jwt-vc-issuer')).status).toBe(500)

    publishIssuerService({ getJwtVcIssuerMetadata: () => ({ issuer: 'https://agent.example' }) } as never)
    const served = await request(middleware).get('/.well-known/jwt-vc-issuer')

    expect(served.status).toBe(200)
    expect(served.body).toEqual({ issuer: 'https://agent.example' })
  })
})
