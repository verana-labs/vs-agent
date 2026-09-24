import type { OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'

import { describe, expect, it } from 'vitest'

import { IssuerService, OPENID4VC_OPTIONS, VerifierService } from '@verana-labs/vs-agent-plugin-openid4vc'

import { V2Openid4vcCredentialExchangesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'
import { OpenId4VcNestPlugin } from '../src/plugins/OpenId4VcNestPlugin'

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  credentialConfigurations: [],
})

describe('OpenId4VcNestPlugin', () => {
  it('registers the three v2 controllers', () => {
    expect(OpenId4VcNestPlugin(options()).controllers).toEqual([
      V2Openid4vcCredentialExchangesController,
      V2Openid4vcPresentationsController,
      V2Openid4vcSigningCertificatesController,
    ])
  })

  it('hands Nest the options and both services from a file that declares no capability', () => {
    expect(OpenId4VcNestPlugin(options()).providers).toEqual([
      { provide: OPENID4VC_OPTIONS, useValue: options() },
      IssuerService,
      VerifierService,
    ])
  })

  it('exposes the credo modules and the public middleware', () => {
    const plugin = OpenId4VcNestPlugin(options())

    expect(plugin.name).toBe('openid4vc')
    expect(plugin.credoPlugin?.modules).toHaveProperty('openId4Vc')
    expect(plugin.credoPlugin?.modules).toHaveProperty('x509')
    expect(typeof plugin.publicMiddleware).toBe('function')
    expect(plugin.initialize).toBeUndefined()
  })
})
