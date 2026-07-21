import type { OpenId4VcPluginOptions } from '../src/types'

import { describe, expect, it } from 'vitest'

import {
  findCredentialConfiguration,
  findVerifierPolicy,
  parseOfferClaims,
  validateOpenId4VcOptions,
} from '../src/config'

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
    credentialIssuerCertificates: ['MIIB-test-root'],
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
    options.trust!.developmentCertificateFingerprints = ['SHA256:example']

    expect(() => validateOpenId4VcOptions(options)).not.toThrow()
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
