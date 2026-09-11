import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readOpenId4VcOptions } from '../src/config/openid4vc'

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
