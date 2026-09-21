import type { OpenId4VcPluginOptions } from '@verana-labs/vs-agent-plugin-openid4vc'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IssuerService, VerifierService } from '@verana-labs/vs-agent-plugin-openid4vc'

import { V2Openid4vcCredentialExchangesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcCredentialExchangesController'
import { V2Openid4vcPresentationsController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcPresentationsController'
import { V2Openid4vcSigningCertificatesController } from '../src/controllers/admin/v2/openid4vc/V2Openid4vcSigningCertificatesController'
import { OpenId4VcNestPlugin } from '../src/plugins/OpenId4VcNestPlugin'

const { ensureIssuer, ensureVerifier } = vi.hoisted(() => ({
  ensureIssuer: vi.fn(),
  ensureVerifier: vi.fn(),
}))

vi.mock('@verana-labs/vs-agent-plugin-openid4vc', async importOriginal => {
  const actual = await importOriginal<typeof import('@verana-labs/vs-agent-plugin-openid4vc')>()
  return {
    ...actual,
    IssuerService: class {
      public ensureInitialized = ensureIssuer
    },
    VerifierService: class {
      public ensureInitialized = ensureVerifier
    },
  }
})

const options = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  credentialConfigurations: [],
  verifierPolicies: [],
})

type FactoryProvider = { provide: unknown; useFactory: (agent: unknown) => unknown; inject: string[] }

function providers(plugin: ReturnType<typeof OpenId4VcNestPlugin>): FactoryProvider[] {
  return plugin.providers as FactoryProvider[]
}

describe('OpenId4VcNestPlugin', () => {
  beforeEach(() => {
    ensureIssuer.mockReset().mockResolvedValue(undefined)
    ensureVerifier.mockReset().mockResolvedValue(undefined)
  })

  it('registers the three v2 controllers', () => {
    expect(OpenId4VcNestPlugin(options()).controllers).toEqual([
      V2Openid4vcCredentialExchangesController,
      V2Openid4vcPresentationsController,
      V2Openid4vcSigningCertificatesController,
    ])
  })

  it('provides both services from a configuration file that declares no capability', () => {
    expect(providers(OpenId4VcNestPlugin(options())).map(provider => provider.provide)).toEqual([
      IssuerService,
      VerifierService,
    ])
    expect(
      providers(OpenId4VcNestPlugin(options())).every(provider => provider.inject[0] === 'VSAGENT'),
    ).toBe(true)
  })

  it('initializes both capabilities from a configuration file that declares no capability', async () => {
    await OpenId4VcNestPlugin(options()).initialize?.({} as never, {} as never)

    expect(ensureIssuer).toHaveBeenCalledOnce()
    expect(ensureVerifier).toHaveBeenCalledOnce()
  })

  it('exposes the credo modules and the public middleware', () => {
    const plugin = OpenId4VcNestPlugin(options())

    expect(plugin.name).toBe('openid4vc')
    expect(plugin.credoPlugin?.modules).toHaveProperty('openId4Vc')
    expect(plugin.credoPlugin?.modules).toHaveProperty('x509')
    expect(typeof plugin.publicMiddleware).toBe('function')
  })

  it('initializes the same service instances the providers hand to Nest', async () => {
    const plugin = OpenId4VcNestPlugin(options())
    const agent = {}
    const [issuer, verifier] = providers(plugin).map(provider => provider.useFactory(agent))

    await plugin.initialize?.(agent as never, {} as never)

    expect(ensureIssuer).toHaveBeenCalledOnce()
    expect(ensureVerifier).toHaveBeenCalledOnce()
    expect(providers(plugin)[0].useFactory(agent)).toBe(issuer)
    expect(providers(plugin)[1].useFactory(agent)).toBe(verifier)
  })

  it('initializes the issuer before the verifier', async () => {
    const order: string[] = []
    ensureIssuer.mockImplementation(async () => {
      order.push('issuer')
    })
    ensureVerifier.mockImplementation(async () => {
      order.push('verifier')
    })

    await OpenId4VcNestPlugin(options()).initialize?.({} as never, {} as never)

    expect(order).toEqual(['issuer', 'verifier'])
  })

  it('propagates an initialization failure', async () => {
    ensureIssuer.mockRejectedValue(new Error('invalid certificate'))

    await expect(OpenId4VcNestPlugin(options()).initialize?.({} as never, {} as never)).rejects.toThrow(
      'invalid certificate',
    )
  })

  it('refuses invalid options synchronously', () => {
    const invalid = options()
    invalid.publicApiBaseUrl = 'not-a-url'

    expect(() => OpenId4VcNestPlugin(invalid)).toThrow('publicApiBaseUrl must be a valid URL')
  })
})
