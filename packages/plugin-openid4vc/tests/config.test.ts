import type { OpenId4VcPluginOptions } from '../src/types'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  findCredentialConfiguration,
  findVerifierPolicy,
  parseOfferClaims,
  validateOpenId4VcOptions,
} from '../src/config'

import { createCertificateFixtures } from './helpers/certificates'

let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

beforeAll(async () => {
  fixtures = await createCertificateFixtures()
})

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
    credentialIssuerCertificates: [fixtures.root.toString('base64')],
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

describe('validateOpenId4VcOptions', () => {
  it('accepts a valid issuer and verifier configuration', () => {
    expect(() => validateOpenId4VcOptions(validOptions())).not.toThrow()
  })

  it('rejects a plugin with no capability', () => {
    const options = validOptions()
    delete options.issuer
    delete options.verifier

    expect(() => validateOpenId4VcOptions(options)).toThrow('issuer or verifier')
  })

  it('rejects a non-HTTPS public URL outside test mode', () => {
    const options = validOptions()
    options.publicApiBaseUrl = 'http://agent.example'
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      expect(() => validateOpenId4VcOptions(options)).toThrow('publicApiBaseUrl')
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('supports a public API base path', () => {
    const options = validOptions()
    options.publicApiBaseUrl = 'https://agent.example/public/base'

    expect(() => validateOpenId4VcOptions(options)).not.toThrow()
  })

  it.each([
    ['publicApiBaseUrl', (options: OpenId4VcPluginOptions, url: string) => (options.publicApiBaseUrl = url)],
    [
      'vct',
      (options: OpenId4VcPluginOptions, url: string) => (options.credentialConfigurations[0].vct = url),
    ],
    [
      'vtjscId',
      (options: OpenId4VcPluginOptions, url: string) => (options.credentialConfigurations[0].vtjscId = url),
    ],
    [
      'trust.resolverUrl',
      (options: OpenId4VcPluginOptions, url: string) => (options.trust!.resolverUrl = url),
    ],
  ] as const)('rejects credentials in %s without exposing them', (field, setUrl) => {
    const username = 'private-url-username'
    const password = 'private-url-password'
    const options = validOptions()
    setUrl(options, `https://${username}:${password}@agent.example/base`)

    const error = catchValidationError(options)

    expect(error.message).toContain(field)
    expect(String(error)).not.toContain(username)
    expect(String(error)).not.toContain(password)
    expect(JSON.stringify(error)).not.toContain(username)
    expect(JSON.stringify(error)).not.toContain(password)
  })

  it('rejects duplicate credential configuration IDs', () => {
    const options = validOptions()
    options.credentialConfigurations.push({ ...options.credentialConfigurations[0] })

    expect(() => validateOpenId4VcOptions(options)).toThrow('credential configuration ID')
  })

  it('rejects a non-dc+sd-jwt credential format', () => {
    const options = validOptions()
    ;(options.credentialConfigurations[0] as { format: string }).format = 'jwt_vc_json'

    expect(() => validateOpenId4VcOptions(options)).toThrow('dc+sd-jwt')
  })

  it('rejects empty credential claims', () => {
    const options = validOptions()
    options.credentialConfigurations[0].claims = []

    expect(() => validateOpenId4VcOptions(options)).toThrow('claims')
  })

  it.each(['vct', 'iat', 'exp', 'iss', 'cnf'])('rejects reserved credential claim %s', claim => {
    const options = validOptions()
    options.credentialConfigurations[0].claims.push(claim)

    expect(() => validateOpenId4VcOptions(options)).toThrow(`reserved claim '${claim}'`)
  })

  it('rejects a disclosure outside the claim allowlist', () => {
    const options = validOptions()
    options.credentialConfigurations[0].disclosureFrame = ['name', 'admin']

    expect(() => validateOpenId4VcOptions(options)).toThrow('disclosureFrame')
  })

  it('rejects an invalid credential TTL', () => {
    const options = validOptions()
    options.credentialConfigurations[0].ttlSeconds = 59

    expect(() => validateOpenId4VcOptions(options)).toThrow('ttlSeconds')
  })

  it('rejects a verifier policy for an unknown credential configuration', () => {
    const options = validOptions()
    options.verifierPolicies[0].credentialConfigurationId = 'unknown'

    expect(() => validateOpenId4VcOptions(options)).toThrow('credentialConfigurationId')
  })

  it('rejects verifier mode without credential issuer trust anchors', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = []

    expect(() => validateOpenId4VcOptions(options)).toThrow('credentialIssuerCertificates')
  })

  it('accepts development certificate fingerprints as verifier trust anchors', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = []
    options.trust!.developmentCertificateFingerprints = [`SHA256:${'0'.repeat(64)}`]

    expect(() => validateOpenId4VcOptions(options)).not.toThrow()
  })

  it('rejects malformed credential issuer certificate material without exposing it', () => {
    const malformed = 'private-malformed-certificate-material'
    const options = validOptions()
    options.trust!.credentialIssuerCertificates.push(malformed)

    const error = catchValidationError(options)

    expect(error.message).toContain('credentialIssuerCertificates[1]')
    expect(String(error)).not.toContain(malformed)
    expect(JSON.stringify(error)).not.toContain(malformed)
  })

  it('rejects a non-CA certificate as a credential issuer trust anchor', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = [fixtures.attacker.toString('base64')]

    expect(() => validateOpenId4VcOptions(options)).toThrow('CA trust anchor')
  })

  it('rejects an intermediate CA as a root trust anchor', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = [fixtures.intermediate.toString('base64')]

    expect(() => validateOpenId4VcOptions(options)).toThrow('root trust anchor')
  })

  it('rejects an expired credential issuer root', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = [fixtures.expiredRoot.toString('base64')]

    expect(() => validateOpenId4VcOptions(options)).toThrow('expired')
  })

  it('rejects duplicate credential issuer roots across encodings', () => {
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = [
      fixtures.root.toString('base64'),
      fixtures.root.toString('pem'),
    ]

    expect(() => validateOpenId4VcOptions(options)).toThrow('duplicate credential issuer certificate')
  })

  it.each(['SHA256:example', `sha256:${'0'.repeat(64)}`, `SHA256:${'A'.repeat(64)}`])(
    'rejects malformed development certificate fingerprint %s',
    fingerprint => {
      const options = validOptions()
      options.trust!.credentialIssuerCertificates = []
      options.trust!.developmentCertificateFingerprints = [fingerprint]

      expect(() => validateOpenId4VcOptions(options)).toThrow('SHA256')
    },
  )

  it('rejects duplicate development certificate fingerprints', () => {
    const fingerprint = `SHA256:${'0'.repeat(64)}`
    const options = validOptions()
    options.trust!.credentialIssuerCertificates = []
    options.trust!.developmentCertificateFingerprints = [fingerprint, fingerprint]

    expect(() => validateOpenId4VcOptions(options)).toThrow(
      'developmentCertificateFingerprints must not contain duplicates',
    )
  })

  it('requires an explicit DID web host allowlist and a bounded resolution timeout', () => {
    const missingHosts = validOptions()
    missingHosts.trust!.allowedDidWebHosts = []
    expect(() => validateOpenId4VcOptions(missingHosts)).toThrow('allowedDidWebHosts')

    const excessiveTimeout = validOptions()
    excessiveTimeout.trust!.timeoutMs = 30_001
    expect(() => validateOpenId4VcOptions(excessiveTimeout)).toThrow('timeoutMs')
  })

  it('rejects required wallet attestation without attestation anchors', () => {
    const options = validOptions()
    options.issuer!.requireWalletAttestation = true

    expect(() => validateOpenId4VcOptions(options)).toThrow('walletAttestationCertificates')
  })

  it('rejects configured and development signing modes selected together', () => {
    const options = validOptions()
    ;(options.issuer!.signing as unknown as { configured: unknown }).configured = {
      certificateChain: ['MIIB-test-cert'],
      privateJwk: {} as never,
    }

    expect(() => validateOpenId4VcOptions(options)).toThrow('signing')
  })
})

function catchValidationError(options: OpenId4VcPluginOptions): Error {
  try {
    validateOpenId4VcOptions(options)
  } catch (error) {
    if (error instanceof Error) return error
  }

  throw new Error('expected OpenID4VC option validation to fail')
}

describe('configuration lookups', () => {
  it('finds configured credential configurations and verifier policies', () => {
    const options = validOptions()

    expect(findCredentialConfiguration(options, 'employee')).toBe(options.credentialConfigurations[0])
    expect(findVerifierPolicy(options, 'employee-check')).toBe(options.verifierPolicies[0])
  })

  it('returns undefined for unknown configuration IDs', () => {
    const options = validOptions()

    expect(findCredentialConfiguration(options, 'unknown')).toBeUndefined()
    expect(findVerifierPolicy(options, 'unknown')).toBeUndefined()
  })
})

describe('parseOfferClaims', () => {
  it('returns only allowed, non-empty claims', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(parseOfferClaims(config, { name: 'Ada', role: 'engineer' })).toEqual({
      name: 'Ada',
      role: 'engineer',
    })
  })

  it('rejects missing and unknown claims', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(() => parseOfferClaims(config, { name: 'Ada' })).toThrow("claim 'role'")
    expect(() => parseOfferClaims(config, { name: 'Ada', role: 'engineer', admin: true })).toThrow(
      "unknown claim 'admin'",
    )
  })

  it('rejects empty offered claims', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(() => parseOfferClaims(config, { name: '', role: 'engineer' })).toThrow("claim 'name'")
  })
})
