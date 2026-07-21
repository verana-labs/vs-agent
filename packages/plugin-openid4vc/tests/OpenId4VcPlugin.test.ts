import type { OpenId4VcPluginOptions } from '../src/types'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenId4VcPlugin } from '../src/nestjs/OpenId4VcPlugin'

const { loadSigningCertificate } = vi.hoisted(() => ({
  loadSigningCertificate: vi.fn(),
}))

vi.mock('../src/services/CertificateService', () => ({ loadSigningCertificate }))

interface FactoryProvider {
  provide: { name?: string }
  useFactory: (agent: never) => {
    ensureInitialized: () => Promise<void>
  }
}

const validOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {
    id: 'issuer',
    displayName: 'Example Issuer',
    signing: { development: { enabled: true, commonName: 'Example Issuer' } },
  },
  verifier: {
    id: 'verifier',
    displayName: 'Example Verifier',
    signing: { development: { enabled: true, commonName: 'Example Verifier' } },
  },
  trust: {
    resolverUrl: 'https://resolver.example/v1/trust',
    timeoutMs: 5_000,
    credentialIssuerCertificates: ['MIIB-trusted-root'],
  },
  credentialConfigurations: [],
  verifierPolicies: [],
})

function provider(plugin: VsAgentNestPlugin, name: string): FactoryProvider {
  const found = (plugin.providers as FactoryProvider[]).find(item => item.provide.name === name)
  if (!found) throw new Error(`missing ${name} provider`)
  return found
}

describe('OpenId4VcPlugin', () => {
  beforeEach(() => {
    loadSigningCertificate.mockReset()
  })

  it('validates options synchronously', () => {
    const options = validOptions()
    delete options.issuer
    delete options.verifier

    expect(() => OpenId4VcPlugin(options)).toThrow('issuer or verifier')
  })

  it('creates isolated routers and module instances', () => {
    const first = OpenId4VcPlugin(validOptions())
    const second = OpenId4VcPlugin(validOptions())

    expect(first.publicMiddleware).not.toBe(second.publicMiddleware)
    expect(first.credoPlugin).not.toBe(second.credoPlugin)
    expect(first.credoPlugin?.modules.openId4Vc).not.toBe(second.credoPlugin?.modules.openId4Vc)
    expect(first.credoPlugin?.modules.x509).not.toBe(second.credoPlugin?.modules.x509)
  })

  it('exposes controllers and providers only for enabled issuer and verifier roles', () => {
    const issuerOptions = validOptions()
    delete issuerOptions.verifier
    delete issuerOptions.trust
    const issuer = OpenId4VcPlugin(issuerOptions)

    expect(issuer.controllers?.map(controller => controller.name)).toEqual([
      'IssuerController',
      'VctController',
    ])
    expect((issuer.providers as FactoryProvider[]).map(item => item.provide.name)).toEqual(['IssuerService'])

    const verifierOptions = validOptions()
    delete verifierOptions.issuer
    const verifier = OpenId4VcPlugin(verifierOptions)

    expect(verifier.controllers?.map(controller => controller.name)).toEqual(['VerifierController'])
    expect((verifier.providers as FactoryProvider[]).map(item => item.provide.name)).toEqual([
      'VerifierService',
    ])
    expect(
      [...issuer.controllers!, ...verifier.controllers!].some(controller => /holder/i.test(controller.name)),
    ).toBe(false)
  })

  it('uses the same service instances for providers and initialization', async () => {
    loadSigningCertificate.mockResolvedValue({})
    const plugin = OpenId4VcPlugin(validOptions())
    const agent = {} as never
    const issuerService = provider(plugin, 'IssuerService').useFactory(agent)
    const verifierService = provider(plugin, 'VerifierService').useFactory(agent)
    const issuerInitialize = vi.spyOn(issuerService, 'ensureInitialized')
    const verifierInitialize = vi.spyOn(verifierService, 'ensureInitialized')

    await plugin.initialize?.(agent, {} as never)

    expect(provider(plugin, 'IssuerService').useFactory(agent)).toBe(issuerService)
    expect(provider(plugin, 'VerifierService').useFactory(agent)).toBe(verifierService)
    expect(issuerInitialize).toHaveBeenCalledOnce()
    expect(verifierInitialize).toHaveBeenCalledOnce()
  })

  it('awaits all enabled services before initialization resolves', async () => {
    let resolveIssuer: (() => void) | undefined
    let resolveVerifier: (() => void) | undefined
    loadSigningCertificate
      .mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            resolveIssuer = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            resolveVerifier = resolve
          }),
      )
    const plugin = OpenId4VcPlugin(validOptions())

    let initialized = false
    const initialization = plugin.initialize?.({} as never, {} as never).then(() => {
      initialized = true
    })
    await Promise.resolve()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
    expect(initialized).toBe(false)
    resolveIssuer?.()
    resolveVerifier?.()
    await initialization
    expect(initialized).toBe(true)
  })

  it('propagates enabled-service initialization failures', async () => {
    loadSigningCertificate.mockRejectedValueOnce(
      new Error('configured private key does not match the leaf certificate'),
    )
    loadSigningCertificate.mockResolvedValueOnce({})
    const plugin = OpenId4VcPlugin(validOptions())

    await expect(plugin.initialize?.({} as never, {} as never)).rejects.toThrow(
      'does not match the leaf certificate',
    )
  })
})
