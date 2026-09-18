import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readOpenId4VcOptions } from '../src/config/openid4vc'

const publicApiBaseUrl = 'https://agent.example'

const validConfig = () => ({
  issuer: {
    displayName: 'Example Issuer',
    signing: { development: { enabled: true, commonName: 'Example Issuer' } },
  },
  verifier: {
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
    },
  ],
  verifierPolicies: [
    { id: 'employee-check', credentialConfigurationId: 'employee', requestedClaims: ['name'] },
  ],
})

describe('OpenID4VC configuration file', () => {
  let fixtureDirectory: string
  let configPath: string

  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'vs-agent-openid4vc-'))
    configPath = join(fixtureDirectory, 'openid4vc.json')
    await writeFile(configPath, JSON.stringify(validConfig()))
  })

  afterEach(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true })
  })

  it('reads and validates the file and injects the trusted public API base URL', async () => {
    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).resolves.toEqual({
      ...validConfig(),
      publicApiBaseUrl,
    })
  })

  it('refuses a file that still carries a revocation block', async () => {
    await writeFile(configPath, JSON.stringify({ ...validConfig(), revocation: { enabled: true } }))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      "unknown top-level field 'revocation'",
    )
  })

  it('rejects a public API base URL supplied by the file', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ ...validConfig(), publicApiBaseUrl: 'https://attacker.example' }),
    )

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      'publicApiBaseUrl must not be set',
    )
  })

  it.each(['issuer', 'verifier'])('rejects a configured %s identifier segment', async capability => {
    const config = validConfig() as unknown as Record<string, Record<string, unknown>>
    config[capability].id = capability

    await writeFile(configPath, JSON.stringify(config))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      `contains unknown field '${capability}.id'`,
    )
  })

  it('rejects a credential configuration that still carries the offer lifetime', async () => {
    const config = validConfig()
    ;(config.credentialConfigurations[0] as Record<string, unknown>).ttlSeconds = 3_600

    await writeFile(configPath, JSON.stringify(config))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      "contains unknown field 'credentialConfigurations[0].ttlSeconds'",
    )
  })

  it('rejects an unknown field in a verifier policy entry', async () => {
    const config = validConfig()
    ;(config.verifierPolicies[0] as Record<string, unknown>).unexpected = 'value'

    await writeFile(configPath, JSON.stringify(config))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      "contains unknown field 'verifierPolicies[0].unexpected'",
    )
  })

  it('rejects an unknown top-level key without echoing its value', async () => {
    const secretValue = 'unknown-field-secret-value'
    await writeFile(configPath, JSON.stringify({ ...validConfig(), unexpected: secretValue }))

    const error = await readOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("unknown top-level field 'unexpected'")
    expect(error.message).not.toContain(secretValue)
  })

  it('does not echo private JWK or certificate values in validation errors', async () => {
    const privateValue = 'private-jwk-secret-value'
    const certificateValue = 'private-certificate-value'
    const config = validConfig()
    config.issuer.signing = {
      configured: { certificateChain: [certificateValue], privateJwk: privateValue },
    } as never
    await writeFile(configPath, JSON.stringify(config))

    const error = await readOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('issuer.signing.configured.privateJwk')
    expect(error.message).not.toContain(privateValue)
    expect(error.message).not.toContain(certificateValue)
  })

  it('reports a missing or unreadable file without system error details', async () => {
    const missingPath = join(fixtureDirectory, 'missing.json')

    await expect(readOpenId4VcOptions(missingPath, publicApiBaseUrl)).rejects.toThrow(
      `Unable to read OpenID4VC configuration file '${missingPath}'`,
    )
    await expect(readOpenId4VcOptions(fixtureDirectory, publicApiBaseUrl)).rejects.toThrow(
      `Unable to read OpenID4VC configuration file '${fixtureDirectory}'`,
    )
  })

  it('rejects malformed JSON without echoing configuration values', async () => {
    const privateValue = 'malformed-private-jwk-value'
    await writeFile(configPath, `{"issuer":{"signing":{"privateJwk":"${privateValue}"}}`)

    const error = await readOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(`Invalid JSON in OpenID4VC configuration file '${configPath}'`)
    expect(error.message).not.toContain(privateValue)
  })

  it('rejects a JSON document that is not an object', async () => {
    await writeFile(configPath, JSON.stringify(['not-an-object']))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      'must contain a JSON object',
    )
  })
})

describe('OpenID4VC configuration location', () => {
  const location = 'https://config.example/openid4vc.json?token=query-secret-value'
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('fetches an https location once without following a redirect, then validates it', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(validConfig()), { status: 200 }))

    await expect(readOpenId4VcOptions(location, publicApiBaseUrl)).resolves.toEqual({
      ...validConfig(),
      publicApiBaseUrl,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(location, { redirect: 'manual', signal: expect.any(AbortSignal) })
  })

  it('refuses a redirect and names the location without its query string', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/openid4vc.json' } }),
    )

    const error = await readOpenId4VcOptions(location, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("'https://config.example/openid4vc.json' answered with a redirect")
    expect(error.message).not.toContain('query-secret-value')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    'http://config.example/openid4vc.json',
    'file:///run/config/openid4vc.json',
  ])('refuses %s without reading it', async value => {
    await expect(readOpenId4VcOptions(value, publicApiBaseUrl)).rejects.toThrow('must use https')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
