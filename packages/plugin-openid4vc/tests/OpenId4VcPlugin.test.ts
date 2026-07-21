import type { OpenId4VcPluginOptions } from '../src/types'
import type { VsAgentNestPlugin } from '@verana-labs/vs-agent-sdk'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenId4VcPlugin } from '../src/nestjs/OpenId4VcPlugin'

const { loadSigningCertificate, verifyKeyBoundToDid } = vi.hoisted(() => ({
  loadSigningCertificate: vi.fn(),
  verifyKeyBoundToDid: vi.fn(),
}))

vi.mock('../src/services/CertificateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/services/CertificateService')>()),
  loadSigningCertificate,
}))
vi.mock('../src/trust/keyBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/trust/keyBinding')>()),
  verifyKeyBoundToDid,
}))

const AGENT_DID = 'did:example:issuer'
const signingHandle = {
  certificate: {
    sanUriNames: [AGENT_DID],
    publicJwk: {
      toJson: () => ({
        kty: 'EC',
        crv: 'P-256',
        x: 'f83OJ3D2xF4vJZFGh7LbqoFh8z3eYMSO5Rohb7EBM0Y',
        y: 'x_FEzRu9C79d3eRWUSYufNWJckU1iK4R0jP4lJv-Eow',
      }),
    },
  },
  chain: [],
  keyId: 'issuer-key',
  development: false,
}

function validAgent() {
  return {
    did: AGENT_DID,
    dids: {},
    genericRecords: {},
    kms: {},
    x509: {},
    modules: {
      openId4Vc: {
        issuer: {
          getIssuerByIssuerId: vi.fn().mockResolvedValue({ issuerId: 'issuer' }),
          createIssuer: vi.fn(),
          updateIssuerMetadata: vi.fn(),
          createCredentialOffer: vi.fn(),
          getIssuanceSessionById: vi.fn(),
        },
        verifier: {
          getVerifierByVerifierId: vi.fn().mockResolvedValue({ verifierId: 'verifier' }),
          createVerifier: vi.fn(),
          updateVerifierMetadata: vi.fn(),
          createAuthorizationRequest: vi.fn(),
          getVerificationSessionById: vi.fn(),
          getVerifiedAuthorizationResponse: vi.fn(),
        },
      },
    },
  }
}

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
    allowedDidWebHosts: ['issuer.example'],
    credentialIssuerCertificates: [],
    developmentCertificateFingerprints: [`SHA256:${'0'.repeat(64)}`],
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
    verifyKeyBoundToDid.mockReset()
    verifyKeyBoundToDid.mockResolvedValue('bound')
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

    expect(issuer.controllers?.map(controller => controller.name)).toEqual(['IssuerController'])
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
    loadSigningCertificate.mockResolvedValue(signingHandle)
    const plugin = OpenId4VcPlugin(validOptions())
    const agent = validAgent() as never
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
    let resolveIssuer: ((value: typeof signingHandle) => void) | undefined
    let resolveVerifier: ((value: typeof signingHandle) => void) | undefined
    loadSigningCertificate
      .mockImplementationOnce(
        () =>
          new Promise<typeof signingHandle>(resolve => {
            resolveIssuer = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<typeof signingHandle>(resolve => {
            resolveVerifier = resolve
          }),
      )
    const plugin = OpenId4VcPlugin(validOptions())
    const agent = validAgent() as never

    let initialized = false
    const initialization = plugin.initialize?.(agent, {} as never).then(() => {
      initialized = true
    })
    await Promise.resolve()

    expect(loadSigningCertificate).toHaveBeenCalledTimes(2)
    expect(initialized).toBe(false)
    resolveIssuer?.(signingHandle)
    resolveVerifier?.(signingHandle)
    await initialization
    expect(initialized).toBe(true)
  })

  it('propagates enabled-service initialization failures', async () => {
    loadSigningCertificate.mockRejectedValueOnce(
      new Error('configured private key does not match the leaf certificate'),
    )
    loadSigningCertificate.mockResolvedValueOnce({})
    const plugin = OpenId4VcPlugin(validOptions())

    await expect(plugin.initialize?.(validAgent() as never, {} as never)).rejects.toThrow(
      'does not match the leaf certificate',
    )
  })
})
