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

const readError = async (location: string) => {
  const { options, errors } = await readOpenId4VcOptions(location, publicApiBaseUrl)
  expect(options).toBeUndefined()
  expect(errors).toHaveLength(1)
  return errors[0]
}

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
      options: readOptions(),
      errors: [],
    })
  })

  it('accepts an empty document and defaults the internal structures', async () => {
    await writeFile(configPath, JSON.stringify({}))

    await expect(readOpenId4VcOptions(configPath, publicApiBaseUrl)).resolves.toEqual({
      options: { publicApiBaseUrl, credentialConfigurations: [] },
      errors: [],
    })
  })

  it.each([
    'trust',
    'credentialConfigurations',
    'verifierPolicies',
  ])('rejects the %s block, which the spec does not define', async field => {
    await writeFile(configPath, JSON.stringify({ ...validConfig(), [field]: [] }))

    expect(await readError(configPath)).toContain(`unknown field '${field}'`)
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

    expect(await readError(configPath)).toContain(`unknown field '${capability}.${field}'`)
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

    expect(await readError(configPath)).toContain(`unknown field '${field}'`)
  })

  it('rejects a key attestation root that is not an X.509 certificate', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ issuer: { keyAttestationCertificates: ['not-a-certificate'] } }),
    )

    expect(await readError(configPath)).toContain(
      'issuer.keyAttestationCertificates[0] must be a valid X.509 certificate',
    )
  })

  it.each([
    ['issuer', 'hello'],
    ['issuer', []],
    ['verifier', 42],
  ])('rejects a %s that is not an object: %j', async (capability, value) => {
    await writeFile(configPath, JSON.stringify({ [capability]: value }))

    expect(await readError(configPath)).toContain(`${capability} must be a JSON object`)
  })

  it('rejects a null signing block instead of dying while reading it', async () => {
    await writeFile(configPath, JSON.stringify({ issuer: { signing: null } }))

    expect(await readError(configPath)).toContain('issuer.signing must be a JSON object')
  })

  it('refuses a file that carries a revocation block', async () => {
    await writeFile(configPath, JSON.stringify({ ...validConfig(), revocation: { enabled: true } }))

    expect(await readError(configPath)).toContain("unknown field 'revocation'")
  })

  it('rejects a public API base URL supplied by the file', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ ...validConfig(), publicApiBaseUrl: 'https://attacker.example' }),
    )

    expect(await readError(configPath)).toContain("unknown field 'publicApiBaseUrl'")
  })

  it.each(['issuer', 'verifier'])('rejects a configured %s identifier segment', async capability => {
    const config = validConfig() as unknown as Record<string, Record<string, unknown>>
    config[capability].id = capability

    await writeFile(configPath, JSON.stringify(config))

    expect(await readError(configPath)).toContain(`unknown field '${capability}.id'`)
  })

  it('rejects an unknown top-level key without echoing its value', async () => {
    const secretValue = 'unknown-field-secret-value'
    await writeFile(configPath, JSON.stringify({ ...validConfig(), unexpected: secretValue }))

    const error = await readError(configPath)

    expect(error).toContain("unknown field 'unexpected'")
    expect(error).not.toContain(secretValue)
  })

  it('does not echo private JWK or certificate values in validation errors', async () => {
    const privateValue = 'private-jwk-secret-value'
    const certificateValue = 'private-certificate-value'
    const config = validConfig() as { issuer: Record<string, unknown> }
    config.issuer.signing = {
      configured: { certificateChain: [certificateValue], privateJwk: privateValue },
    }
    await writeFile(configPath, JSON.stringify(config))

    const error = await readError(configPath)

    expect(error).toContain('issuer.signing.configured.privateJwk')
    expect(error).not.toContain(privateValue)
    expect(error).not.toContain(certificateValue)
  })

  it('reports a missing or unreadable file without system error details', async () => {
    const missingPath = join(fixtureDirectory, 'missing.json')

    expect(await readError(missingPath)).toContain(
      `Unable to read OpenID4VC configuration file '${missingPath}'`,
    )
    expect(await readError(fixtureDirectory)).toContain(
      `Unable to read OpenID4VC configuration file '${fixtureDirectory}'`,
    )
  })

  it('rejects malformed JSON without echoing configuration values', async () => {
    const privateValue = 'malformed-private-jwk-value'
    await writeFile(configPath, `{"issuer":{"signing":{"privateJwk":"${privateValue}"}}`)

    const error = await readError(configPath)

    expect(error).toContain(`Invalid JSON in OpenID4VC configuration file '${configPath}'`)
    expect(error).not.toContain(privateValue)
  })

  it('rejects a JSON document that is not an object', async () => {
    await writeFile(configPath, JSON.stringify(['not-an-object']))

    expect(await readError(configPath)).toContain('the OpenID4VC configuration must be a JSON object')
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
      options: readOptions(),
      errors: [],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(location, { redirect: 'manual', signal: expect.any(AbortSignal) })
  })

  it('refuses a redirect and names the location without its query string', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/openid4vc.json' } }),
    )

    const error = await readError(location)

    expect(error).toContain("'https://config.example/openid4vc.json' answered with a redirect")
    expect(error).not.toContain('query-secret-value')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    'http://config.example/openid4vc.json',
    'file:///run/config/openid4vc.json',
  ])('refuses %s without reading it', async value => {
    expect(await readError(value)).toContain('must use https')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
