import type { OpenId4VcPluginOptions } from '../src/types'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  findCredentialConfiguration,
  parseOfferClaims,
  parseOfferIssuanceMetadata,
  parseOfferTtlSeconds,
  parseOpenId4VcConfiguration,
} from '../src/config'

import { createCertificateFixtures } from './helpers/certificates'

let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

beforeAll(async () => {
  fixtures = await createCertificateFixtures()
})

const validOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {},
  verifier: {},
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
})

const configurationFile = () => ({ issuer: {}, verifier: {} })

const signingMaterial = () => ({
  certificateChain: ['MIIB-fixture-certificate'],
  privateJwk: { kty: 'EC', crv: 'P-256' },
})

describe('parseOpenId4VcConfiguration', () => {
  it('returns a file that configures both capabilities', () => {
    const document = { issuer: { signing: { configured: signingMaterial() } }, verifier: {} }

    expect(parseOpenId4VcConfiguration(document)).toBe(document)
  })

  it.each([{}, { issuer: {} }, { verifier: {} }])('accepts %j', document => {
    expect(() => parseOpenId4VcConfiguration(document)).not.toThrow()
  })

  it.each([null, 'issuer', 42, ['issuer']])('rejects the document %j', document => {
    expect(() => parseOpenId4VcConfiguration(document)).toThrow(
      'the OpenID4VC configuration must be a JSON object',
    )
  })

  it.each([
    ['publicApiBaseUrl', { ...configurationFile(), publicApiBaseUrl: 'https://attacker.example' }],
    ['trust', { ...configurationFile(), trust: {} }],
    ['issuer.displayName', { issuer: { displayName: 'Issuer' } }],
    ['issuer.signing.mode', { issuer: { signing: { configured: signingMaterial(), mode: 'configured' } } }],
    [
      'issuer.signing.configured.passphrase',
      { issuer: { signing: { configured: { ...signingMaterial(), passphrase: 'secret' } } } },
    ],
    [
      'verifier.signing.configured.passphrase',
      { verifier: { signing: { configured: { ...signingMaterial(), passphrase: 'secret' } } } },
    ],
  ])('rejects the unknown field %s at any depth', (field, document) => {
    expect(() => parseOpenId4VcConfiguration(document)).toThrow(`unknown field '${field}'`)
  })

  it.each([
    ['issuer', { issuer: 'configured' }],
    ['issuer.signing', { issuer: { signing: null } }],
    ['verifier.signing', { verifier: { signing: [] } }],
    ['issuer.signing.configured', { issuer: { signing: { configured: 'yes' } } }],
  ])('rejects %s when it is not a JSON object', (field, document) => {
    expect(() => parseOpenId4VcConfiguration(document)).toThrow(`${field} must be a JSON object`)
  })

  it.each([
    ['issuer.signing.configured', { issuer: { signing: {} } }],
    [
      'issuer.signing.configured.privateJwk',
      { issuer: { signing: { configured: { certificateChain: ['MIIB-fixture-certificate'] } } } },
    ],
    [
      'verifier.signing.configured.certificateChain',
      { verifier: { signing: { configured: { privateJwk: { kty: 'EC' } } } } },
    ],
  ])('requires %s', (field, document) => {
    expect(() => parseOpenId4VcConfiguration(document)).toThrow(`${field} is required`)
  })

  it.each([[[]], [['']], [[' ']], [['chain', 7]]])('rejects the certificate chain %j', certificateChain => {
    const document = { issuer: { signing: { configured: { certificateChain, privateJwk: {} } } } }

    expect(() => parseOpenId4VcConfiguration(document)).toThrow(
      'issuer.signing.configured.certificateChain must contain non-empty strings',
    )
  })

  it('accepts attestation roots that parse as X.509 certificates', () => {
    const root = fixtures.root.toString('base64')
    const document = {
      issuer: { walletAttestationCertificates: [root], keyAttestationCertificates: [root, root] },
    }

    expect(() => parseOpenId4VcConfiguration(document)).not.toThrow()
  })

  it.each([
    'issuer.walletAttestationCertificates',
    'issuer.keyAttestationCertificates',
  ])('rejects a %s entry that is not an X.509 certificate', field => {
    const list = [fixtures.root.toString('base64'), 'MIIB-private-attestation-material']
    const document = { issuer: { [field.split('.')[1]]: list } }

    expect(() => parseOpenId4VcConfiguration(document)).toThrow(
      `${field}[1] must be a valid X.509 certificate`,
    )
  })

  it.each([
    'issuer.walletAttestationCertificates',
    'issuer.keyAttestationCertificates',
  ])('rejects a %s that is not an array', field => {
    const document = { issuer: { [field.split('.')[1]]: 'MIIB-fixture-certificate' } }

    expect(() => parseOpenId4VcConfiguration(document)).toThrow(
      `${field} must be an array of X.509 certificates`,
    )
  })

  it('names the offending field without echoing private material', () => {
    const privateValue = 'private-jwk-secret-value'
    const certificateValue = 'private-certificate-value'
    const document = {
      issuer: { signing: { configured: { certificateChain: [certificateValue], privateJwk: privateValue } } },
    }

    const error = catchParseError(document)

    expect(error.message).toContain('issuer.signing.configured.privateJwk must be a JSON object')
    expect(String(error)).not.toContain(privateValue)
    expect(String(error)).not.toContain(certificateValue)
    expect(JSON.stringify(error)).not.toContain(privateValue)
  })
})

function catchParseError(document: unknown): Error {
  try {
    parseOpenId4VcConfiguration(document)
  } catch (error) {
    if (error instanceof Error) return error
  }

  throw new Error('expected the OpenID4VC configuration parser to fail')
}

describe('configuration lookups', () => {
  it('finds a configured credential configuration', () => {
    const options = validOptions()

    expect(findCredentialConfiguration(options, 'employee')).toBe(options.credentialConfigurations[0])
  })

  it('returns undefined for unknown configuration IDs', () => {
    const options = validOptions()

    expect(findCredentialConfiguration(options, 'unknown')).toBeUndefined()
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

  it('omits absent optional claims instead of rejecting them', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(parseOfferClaims(config, { name: 'Ada' })).toEqual({ name: 'Ada' })
  })

  it('rejects unknown claims', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(() => parseOfferClaims(config, { name: 'Ada', role: 'engineer', admin: true })).toThrow(
      "unknown claim 'admin'",
    )
  })

  it('rejects empty offered claims', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(() => parseOfferClaims(config, { name: '', role: 'engineer' })).toThrow("claim 'name'")
    expect(() => parseOfferClaims(config, { name: 'Ada', role: null })).toThrow("claim 'role'")
  })

  it('rejects an offer with no configured claims at all', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(() => parseOfferClaims(config, {})).toThrow('at least one')
  })
})

describe('parseOfferTtlSeconds', () => {
  it.each([60, 3_600, 7_776_000])('accepts %d seconds', value => {
    expect(parseOfferTtlSeconds(value)).toBe(value)
  })

  it.each([59, 7_776_001, 3_600.5, '3600', null, undefined])('rejects %s', value => {
    expect(() => parseOfferTtlSeconds(value)).toThrow('ttlSeconds must be an integer between 60 and 7776000')
  })
})

describe('parseOfferIssuanceMetadata', () => {
  it('returns the stored claims and lifetime of the offer', () => {
    const config = validOptions().credentialConfigurations[0]

    expect(parseOfferIssuanceMetadata(config, { claims: { name: 'Ada' }, ttlSeconds: 3_600 })).toEqual({
      claims: { name: 'Ada' },
      ttlSeconds: 3_600,
    })
  })

  it.each([
    [{ claims: { name: 'Ada' } }, 'ttlSeconds'],
    [{ claims: { admin: true }, ttlSeconds: 3_600 }, "unknown claim 'admin'"],
    [null, 'issuance metadata must be an object'],
  ])('rejects invalid stored metadata %#', (metadata, message) => {
    const config = validOptions().credentialConfigurations[0]

    expect(() => parseOfferIssuanceMetadata(config, metadata)).toThrow(message)
  })
})
