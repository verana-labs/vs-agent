import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadOpenId4VcOptions, loadOptionalOpenId4VcPlugin } from '../src/config/openid4vc'

const publicApiBaseUrl = 'https://agent.example'

const validConfig = () => ({
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
  credentialConfigurations: [
    {
      id: 'employee',
      format: 'dc+sd-jwt',
      vct: 'https://agent.example/oid4vc/vct/employee',
      name: 'Employee credential',
      vtjscId: 'https://agent.example/vt/employee.json',
      claims: ['name', 'role'],
      disclosureFrame: ['name', 'role'],
      ttlSeconds: 3_600,
    },
  ],
  verifierPolicies: [
    { id: 'employee-check', credentialConfigurationId: 'employee', requestedClaims: ['name'] },
  ],
})

describe('OpenID4VC application configuration', () => {
  let fixtureDirectory: string
  let configPath: string

  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'vs-agent-openid4vc-'))
    configPath = join(fixtureDirectory, 'openid4vc.json')
    await writeFile(configPath, JSON.stringify(validConfig()))
  })

  afterEach(async () => {
    vi.doUnmock('@verana-labs/vs-agent-plugin-openid4vc')
    vi.resetModules()
    await rm(fixtureDirectory, { recursive: true, force: true })
  })

  it('does not include private JWK or certificate values in validation errors', async () => {
    const privateValue = 'private-jwk-secret-value'
    const certificateValue = 'private-certificate-value'
    const config = validConfig()
    config.issuer.signing = {
      configured: { certificateChain: [certificateValue], privateJwk: privateValue },
    } as never
    await writeFile(configPath, JSON.stringify(config))

    const error = await loadOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('issuer.signing.configured.privateJwk')
    expect(error.message).not.toContain(privateValue)
    expect(error.message).not.toContain(certificateValue)
  })

  it('does not read or import the optional package when disabled', async () => {
    const packageFactory = vi.fn(() => {
      throw new Error('OpenID4VC package must not be imported')
    })
    vi.doMock('@verana-labs/vs-agent-plugin-openid4vc', packageFactory)

    await expect(
      loadOptionalOpenId4VcPlugin(['messaging'], join(fixtureDirectory, 'missing.json'), publicApiBaseUrl),
    ).resolves.toBeUndefined()
    expect(packageFactory).not.toHaveBeenCalled()
  })

  it('requires a config path before importing an enabled plugin', async () => {
    const packageFactory = vi.fn(() => {
      throw new Error('OpenID4VC package must not be imported')
    })
    vi.doMock('@verana-labs/vs-agent-plugin-openid4vc', packageFactory)

    await expect(
      loadOptionalOpenId4VcPlugin(['messaging', 'openid4vc'], undefined, publicApiBaseUrl),
    ).rejects.toThrow('OID4VC_CONFIG_FILE is required')
    expect(packageFactory).not.toHaveBeenCalled()
  })

  it('propagates an enabled plugin import failure', async () => {
    vi.doMock('@verana-labs/vs-agent-plugin-openid4vc', () => {
      throw new Error('OpenID4VC package import failed')
    })

    await expect(
      loadOptionalOpenId4VcPlugin(['messaging', 'openid4vc'], configPath, publicApiBaseUrl),
    ).rejects.toThrow()
  })

  it('returns the single plugin instance created by the optional package', async () => {
    const plugin = { name: 'openid4vc' }
    const validateOpenId4VcOptions = vi.fn()
    const OpenId4VcPlugin = vi.fn(options => {
      validateOpenId4VcOptions(options)
      return plugin
    })
    vi.doMock('@verana-labs/vs-agent-plugin-openid4vc', () => ({
      validateOpenId4VcOptions,
      OpenId4VcPlugin,
    }))

    await expect(
      loadOptionalOpenId4VcPlugin(['messaging', 'openid4vc'], configPath, publicApiBaseUrl),
    ).resolves.toBe(plugin)
    expect(validateOpenId4VcOptions).toHaveBeenCalledOnce()
    expect(OpenId4VcPlugin).toHaveBeenCalledOnce()
    expect(OpenId4VcPlugin).toHaveBeenCalledWith(expect.objectContaining({ publicApiBaseUrl }))
  })

  it('propagates an enabled plugin factory failure', async () => {
    vi.doMock('@verana-labs/vs-agent-plugin-openid4vc', () => ({
      validateOpenId4VcOptions: vi.fn(),
      OpenId4VcPlugin: () => {
        throw new Error('OpenID4VC plugin factory failed')
      },
    }))

    await expect(
      loadOptionalOpenId4VcPlugin(['messaging', 'openid4vc'], configPath, publicApiBaseUrl),
    ).rejects.toThrow('OpenID4VC plugin factory failed')
  })

  it('loads and validates a JSON object with the trusted public API base URL', async () => {
    await expect(loadOpenId4VcOptions(configPath, publicApiBaseUrl)).resolves.toEqual({
      ...validConfig(),
      publicApiBaseUrl,
    })
  })

  it('rejects a public API base URL supplied by the file', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ ...validConfig(), publicApiBaseUrl: 'https://attacker.example' }),
    )

    await expect(loadOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      'publicApiBaseUrl must not be set',
    )
  })

  it('rejects unknown top-level keys without including their values', async () => {
    const secretValue = 'unknown-field-secret-value'
    await writeFile(configPath, JSON.stringify({ ...validConfig(), unexpected: secretValue }))

    const error = await loadOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("unknown top-level field 'unexpected'")
    expect(error.message).not.toContain(secretValue)
  })

  it('reports missing and unreadable files without exposing system error details', async () => {
    const missingPath = join(fixtureDirectory, 'missing.json')

    await expect(loadOpenId4VcOptions(missingPath, publicApiBaseUrl)).rejects.toThrow(
      `Unable to read OpenID4VC configuration file '${missingPath}'`,
    )
    await expect(loadOpenId4VcOptions(fixtureDirectory, publicApiBaseUrl)).rejects.toThrow(
      `Unable to read OpenID4VC configuration file '${fixtureDirectory}'`,
    )
  })

  it('rejects malformed JSON without including configuration values', async () => {
    const privateValue = 'malformed-private-jwk-value'
    await writeFile(configPath, `{"issuer":{"signing":{"privateJwk":"${privateValue}"}}`)

    const error = await loadOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(`Invalid JSON in OpenID4VC configuration file '${configPath}'`)
    expect(error.message).not.toContain(privateValue)
  })

  it('rejects non-object JSON configuration', async () => {
    await writeFile(configPath, JSON.stringify(['not-an-object']))

    await expect(loadOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      'must contain a JSON object',
    )
  })
})
