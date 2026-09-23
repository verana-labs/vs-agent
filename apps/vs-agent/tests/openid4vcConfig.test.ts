import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readOpenId4VcOptions } from '../src/config/openid4vc'

const publicApiBaseUrl = 'https://agent.example'

const validConfig = () => ({ issuer: {}, verifier: {} })

const signingMaterial = () => ({ certificateChain: ['MIIB-certificate'], privateJwk: { kty: 'EC' } })

const readOptions = () => ({
  ...validConfig(),
  publicApiBaseUrl,
  credentialConfigurations: [],
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
    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).resolves.toEqual(readOptions())
  })

  it('accepts an empty document and defaults the internal structures', async () => {
    await writeFile(configPath, JSON.stringify({}))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).resolves.toEqual({
      publicApiBaseUrl,
      credentialConfigurations: [],
    })
  })

  it.each([
    'trust',
    'credentialConfigurations',
    'verifierPolicies',
  ])('rejects the %s block the spec no longer defines', async field => {
    await writeFile(configPath, JSON.stringify({ ...validConfig(), [field]: [] }))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      `unknown field '${field}'`,
    )
  })

  it.each([
    ['issuer', 'displayName'],
    ['issuer', 'metadataSigner'],
    ['issuer', 'requireWalletAttestation'],
    ['verifier', 'displayName'],
    ['verifier', 'requestSigner'],
  ])('rejects %s.%s', async (capability, field) => {
    const config = validConfig() as unknown as Record<string, Record<string, unknown>>
    config[capability][field] = 'value'

    await writeFile(configPath, JSON.stringify(config))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      `unknown field '${capability}.${field}'`,
    )
  })

  it.each([
    ['issuer.signing.extra', { issuer: { signing: { configured: signingMaterial(), extra: 1 } } }],
    [
      'issuer.signing.configured.extra',
      { issuer: { signing: { configured: { ...signingMaterial(), extra: 1 } } } },
    ],
    [
      'verifier.signing.configured.extra',
      { verifier: { signing: { configured: { ...signingMaterial(), extra: 1 } } } },
    ],
  ])('rejects the unknown nested field %s', async (field, config) => {
    await writeFile(configPath, JSON.stringify(config))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      `unknown field '${field}'`,
    )
  })

  it('rejects a key attestation root that is not an X.509 certificate', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ issuer: { keyAttestationCertificates: ['not-a-certificate'] } }),
    )

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      'issuer.keyAttestationCertificates[0] must be a valid X.509 certificate',
    )
  })

  it.each([
    ['issuer', 'hello'],
    ['issuer', []],
    ['verifier', 42],
  ])('rejects a %s that is not an object: %j', async (capability, value) => {
    await writeFile(configPath, JSON.stringify({ [capability]: value }))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      `${capability} must be a JSON object`,
    )
  })

  it('rejects a null signing block instead of dying while reading it', async () => {
    await writeFile(configPath, JSON.stringify({ issuer: { signing: null } }))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      'issuer.signing must be a JSON object',
    )
  })

  it('refuses a file that still carries a revocation block', async () => {
    await writeFile(configPath, JSON.stringify({ ...validConfig(), revocation: { enabled: true } }))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      "unknown field 'revocation'",
    )
  })

  it('rejects a public API base URL supplied by the file', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ ...validConfig(), publicApiBaseUrl: 'https://attacker.example' }),
    )

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      "unknown field 'publicApiBaseUrl'",
    )
  })

  it.each(['issuer', 'verifier'])('rejects a configured %s identifier segment', async capability => {
    const config = validConfig() as unknown as Record<string, Record<string, unknown>>
    config[capability].id = capability

    await writeFile(configPath, JSON.stringify(config))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).rejects.toThrow(
      `unknown field '${capability}.id'`,
    )
  })

  it('rejects an unknown top-level key without echoing its value', async () => {
    const secretValue = 'unknown-field-secret-value'
    await writeFile(configPath, JSON.stringify({ ...validConfig(), unexpected: secretValue }))

    const error = await readOpenId4VcOptions(configPath, publicApiBaseUrl).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("unknown field 'unexpected'")
    expect(error.message).not.toContain(secretValue)
  })

  it('does not echo private JWK or certificate values in validation errors', async () => {
    const privateValue = 'private-jwk-secret-value'
    const certificateValue = 'private-certificate-value'
    const config = validConfig() as { issuer: Record<string, unknown> }
    config.issuer.signing = {
      configured: { certificateChain: [certificateValue], privateJwk: privateValue },
    }
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
      'the OpenID4VC configuration must be a JSON object',
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

    await expect(readOpenId4VcOptions(location, publicApiBaseUrl)).resolves.toEqual(readOptions())
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
