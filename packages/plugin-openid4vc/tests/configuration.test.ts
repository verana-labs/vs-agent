import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../src/types'
import type { NextFunction, Request, Response } from 'express'

import { ClaimFormat } from '@credo-ts/core'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  findCredentialConfiguration,
  parseOfferClaims,
  parseOfferIssuanceMetadata,
  parseOfferTtlSeconds,
  parseOpenId4VcConfiguration,
} from '../src/config'
import {
  acceptDraftCredentialRequests,
  accommodateOpenId4VciKt,
  setupOpenId4Vc,
} from '../src/sdk/setupOpenId4Vc'

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

const setupOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {},
  verifier: {},
  credentialConfigurations: [],
})

describe('setupOpenId4Vc', () => {
  it('creates a fresh non-global Express application for every setup', () => {
    const first = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    const second = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    expect(first.publicMiddleware).not.toBe(second.publicMiddleware)
    expect(first.modules.openId4Vc.config.app).toBe(first.publicMiddleware)
    expect(second.modules.openId4Vc.config.app).toBe(second.publicMiddleware)
  })

  it('configures both role bases from a file that declares no capability', () => {
    const empty = setupOptions()
    delete empty.issuer
    delete empty.verifier
    const setup = setupOpenId4Vc(empty)

    expect(setup.modules.openId4Vc.config).toHaveProperty('issuer.baseUrl', 'https://agent.example/oid4vci')
    expect(setup.modules.openId4Vc.config).toHaveProperty('verifier.baseUrl', 'https://agent.example/oid4vp')
  })

  it('never anchors a presented credential on the peer-provided chain', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    const peerCertificate = { toString: () => 'MIIB-peer-certificate' }
    const getTrustedCertificates = setup.modules.x509.config.getTrustedCertificatesForVerification

    const anchors = await getTrustedCertificates?.({} as never, {
      certificateChain: [peerCertificate as never],
      verification: { type: 'credential', credential: {} as never },
    })

    expect(anchors).toBeUndefined()
  })

  it('fails the verification of a presented SD-JWT VC that carries no numeric exp', () => {
    const setup = setupOpenId4Vc(setupOptions())
    const getTrustedCertificates = setup.modules.x509.config.getTrustedCertificatesForVerification
    const verify = (payload: Record<string, unknown>) =>
      getTrustedCertificates?.({} as never, {
        certificateChain: [{ toString: () => 'MIIB-peer-certificate' } as never],
        verification: {
          type: 'credential',
          credential: { claimFormat: ClaimFormat.SdJwtDc, payload } as never,
        },
      })
    const vct = 'https://agent.example/oid4vc/vct/employee'

    expect(verify({ vct, exp: 1_784_638_800 })).toBeUndefined()
    expect(() => verify({ vct })).toThrow("carries no numeric 'exp' claim")
    expect(() => verify({ vct, exp: '1784638800' })).toThrow("carries no numeric 'exp' claim")
  })

  it('serves the SD-JWT VC issuer metadata that x5c-anchoring holders resolve', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({
        issuer: 'https://issuer.example',
        jwks: { keys: [{ kty: 'EC', crv: 'P-256' }] },
      }),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    const response = await request(setup.publicMiddleware).get('/.well-known/jwt-vc-issuer')

    expect(response.status).toBe(200)
    expect(response.body.issuer).toBe('https://issuer.example')
    expect(response.body.jwks.keys).toHaveLength(1)
  })

  // RFC 8615 inserts the issuer path after the well-known segment; answering only the bare
  // form made every wwWallet issuance show a metadata-fetch failure above the trust card.
  it('serves the SD-JWT VC issuer metadata at the path-inserted well-known form', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({ issuer: 'https://issuer.example', jwks: { keys: [] } }),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    const response = await request(setup.publicMiddleware).get('/.well-known/jwt-vc-issuer/oid4vci/demo-did')

    expect(response.status).toBe(200)
    expect(response.body.issuer).toBe('https://issuer.example')
  })

  const withSignedMetadata = (signedMetadataJwt: string | undefined) =>
    setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => signedMetadataJwt,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

  it.each([
    '/.well-known/openid-credential-issuer/oid4vci/issuer',
    '/oid4vci/issuer/.well-known/openid-credential-issuer',
  ])('serves the certificate-bound signed metadata at %s', async path => {
    const setup = withSignedMetadata('header.payload.signature')

    const response = await request(setup.publicMiddleware).get(path).set('accept', 'application/jwt')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/jwt')
    expect(response.text).toBe('header.payload.signature')
  })

  // Every client that reads JSON is served JSON, so the signed JWT only ever reaches a client
  // asking for it alone. Answering the others would hand swiyu a JWT it cannot verify.
  it.each([
    'application/json, application/jwt',
    'application/jwt; application/json',
    'application/json',
  ])('leaves %s to the plain metadata endpoint', async accept => {
    const setup = withSignedMetadata('header.payload.signature')

    const response = await request(setup.publicMiddleware)
      .get('/.well-known/openid-credential-issuer/oid4vci/issuer')
      .set('accept', accept)

    expect(response.status).toBe(404)
  })

  it('falls through when no signed metadata exists or the path is not issuer metadata', async () => {
    const absent = await request(withSignedMetadata(undefined).publicMiddleware)
      .get('/.well-known/openid-credential-issuer/oid4vci/issuer')
      .set('accept', 'application/jwt')
    const otherPath = await request(withSignedMetadata('header.payload.signature').publicMiddleware)
      .get('/oid4vci/issuer/credential')
      .set('accept', 'application/jwt')
    const noAccept = await request(withSignedMetadata('header.payload.signature').publicMiddleware).get(
      '/.well-known/openid-credential-issuer/oid4vci/issuer',
    )

    expect(absent.status).toBe(404)
    expect(otherPath.status).toBe(404)
    expect(noAccept.status).toBe(404)
  })

  it('does not advertise wallet attestation metadata without attestation roots', async () => {
    const options = setupOptions()
    const setup = setupOpenId4Vc(options, () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    setup.publicMiddleware.get(
      '/.well-known/oauth-authorization-server/oid4vci/issuer',
      (_request, response) => response.json({ token_endpoint_auth_methods_supported: ['none'] }),
    )

    const response = await request(setup.publicMiddleware).get(
      '/.well-known/oauth-authorization-server/oid4vci/issuer',
    )

    expect(response.body.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(response.body.client_attestation_signing_alg_values_supported).toBeUndefined()
    expect(response.body.client_attestation_pop_signing_alg_values_supported).toBeUndefined()
    expect(setup.modules.openId4Vc.config).toHaveProperty('issuer.walletAttestationsRequired', false)
  })

  it('advertises wallet attestation as soon as attestation roots are configured', async () => {
    const options = setupOptions()
    options.issuer!.walletAttestationCertificates = [fixtures.root.toString('base64')]
    const setup = setupOpenId4Vc(options, () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    setup.publicMiddleware.get(
      '/.well-known/oauth-authorization-server/oid4vci/issuer',
      (_request, response) => response.json({ token_endpoint_auth_methods_supported: ['none'] }),
    )

    const response = await request(setup.publicMiddleware).get(
      '/.well-known/oauth-authorization-server/oid4vci/issuer',
    )

    expect(response.body.token_endpoint_auth_methods_supported).toEqual(['none', 'attest_jwt_client_auth'])
    expect(response.body.client_attestation_signing_alg_values_supported).toEqual(['ES256'])
    expect(response.body.client_attestation_pop_signing_alg_values_supported).toEqual(['ES256'])
    expect(setup.modules.openId4Vc.config).toHaveProperty('issuer.walletAttestationsRequired', true)
  })

  it('mounts no type metadata, credential-offer or credential-exchange route', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    const metadata = await request(setup.publicMiddleware).get('/oid4vc/vct/employee')
    const create = await request(setup.publicMiddleware).post('/v2/openid4vc/credential-offer').send({})
    const list = await request(setup.publicMiddleware).get('/v2/openid4vc/credential-exchanges')

    expect(metadata.status).toBe(404)
    expect(create.status).toBe(404)
    expect(list.status).toBe(404)
  })

  it.each([
    '/.well-known/openid-credential-issuer',
    '/.well-known/oauth-authorization-server',
  ])('serves %s at the bare path credo leaves unrouted', async wellKnown => {
    const setup = setupOpenId4Vc(setupOptions())
    setup.publicMiddleware.get(`${wellKnown}/oid4vci/issuer`, (incoming, response) =>
      response.json({ credential_issuer: 'https://agent.example/oid4vci/issuer', query: incoming.query }),
    )

    const bare = await request(setup.publicMiddleware).get(wellKnown)
    const withQuery = await request(setup.publicMiddleware).get(`${wellKnown}/?v=1`)
    const other = await request(setup.publicMiddleware).get(`${wellKnown}/oid4vci/other`)

    expect(bare.status).toBe(200)
    expect(bare.body.credential_issuer).toBe('https://agent.example/oid4vci/issuer')
    expect(withQuery.status).toBe(200)
    expect(withQuery.body.query).toEqual({ v: '1' })
    expect(other.status).toBe(404)
  })

  it('aliases the bare well-known path under a public API base path', async () => {
    const options = setupOptions()
    options.publicApiBaseUrl = 'https://agent.example/public/base'
    const setup = setupOpenId4Vc(options)
    setup.publicMiddleware.get(
      '/.well-known/openid-credential-issuer/public/base/oid4vci/issuer',
      (_incoming, response) =>
        response.json({ credential_issuer: 'https://agent.example/public/base/oid4vci/issuer' }),
    )

    const response = await request(setup.publicMiddleware).get(
      '/.well-known/openid-credential-issuer/public/base',
    )

    expect(response.status).toBe(200)
    expect(response.body.credential_issuer).toBe('https://agent.example/public/base/oid4vci/issuer')
  })

  it('does not mount verifier presentation or holder routes on the public middleware', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    const requestRoute = await request(setup.publicMiddleware)
      .post('/v2/openid4vc/presentation-request')
      .send({})
    const resultRoute = await request(setup.publicMiddleware).get('/v2/openid4vc/presentations/abc')
    const holderRoute = await request(setup.publicMiddleware).get('/v1/oid4vc/holder/credentials')

    expect(requestRoute.status).toBe(404)
    expect(resultRoute.status).toBe(404)
    expect(holderRoute.status).toBe(404)
  })
})

const configuration: OpenId4VcCredentialConfiguration = {
  id: 'demo-credential',
  format: 'dc+sd-jwt',
  vct: 'https://issuer.example/oid4vc/vct/demo-credential',
  name: 'DemoCredential',
  vtjscId: 'vtjsc:example',
  claims: ['name', 'demoId'],
  disclosureFrame: ['name', 'demoId'],
}

const runCredentialRequest = (body: unknown, overrides: Partial<Request> = {}) => {
  const request = { method: 'POST', path: '/oid4vci/demo-did/credential', body, ...overrides } as Request
  const next = vi.fn() as unknown as NextFunction
  acceptDraftCredentialRequests([configuration])(request, {} as Response, next)
  return { body: request.body, next }
}

describe('acceptDraftCredentialRequests', () => {
  it('names the configuration a draft wallet described by vct', () => {
    const { body, next } = runCredentialRequest({
      format: 'dc+sd-jwt',
      vct: configuration.vct,
      proof: { proof_type: 'jwt' },
    })

    expect(body).toEqual({ credential_configuration_id: 'demo-credential', proof: { proof_type: 'jwt' } })
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves a 1.0 request untouched', () => {
    const original = { credential_configuration_id: 'demo-credential', proof: { proof_type: 'jwt' } }
    const { body } = runCredentialRequest({ ...original })

    expect(body).toEqual(original)
  })

  it('leaves a vct it does not issue untouched, so the wallet still gets the real error', () => {
    const original = { format: 'dc+sd-jwt', vct: 'https://issuer.example/vct/unknown' }
    const { body } = runCredentialRequest({ ...original })

    expect(body).toEqual(original)
  })

  it('does not touch a credential_identifier request', () => {
    const original = { credential_identifier: 'abc', vct: configuration.vct }
    const { body } = runCredentialRequest({ ...original })

    expect(body).toEqual(original)
  })

  it('ignores anything that is not a credential POST', () => {
    const original = { format: 'dc+sd-jwt', vct: configuration.vct }
    expect(runCredentialRequest({ ...original }, { method: 'GET' }).body).toEqual(original)
    expect(runCredentialRequest({ ...original }, { path: '/oid4vci/demo-did/token' }).body).toEqual(original)
  })

  it('passes a non-object body through', () => {
    const { next } = runCredentialRequest(undefined)
    expect(next).toHaveBeenCalledOnce()
  })
})

const OPENID4VCI_KT_ACCEPT = 'application/jwt; application/json'

const metadata = (proofTypes: Record<string, unknown>) =>
  JSON.stringify({
    credential_issuer: 'https://issuer.example/oid4vci/demo-did',
    credential_configurations_supported: {
      'demo-credential': { format: 'dc+sd-jwt', proof_types_supported: proofTypes },
    },
  })

const runMetadataRequest = (
  accept: string | undefined,
  body: string,
  overrides: Partial<Request> = {},
  hasAnchor = true,
) => {
  const request = {
    method: 'GET',
    path: '/oid4vci/demo-did/.well-known/openid-credential-issuer',
    headers: accept === undefined ? {} : { accept },
    ...overrides,
  } as unknown as Request
  let sent: unknown
  const response = {
    send: (payload?: unknown) => {
      sent = payload
      return response
    },
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  accommodateOpenId4VciKt(hasAnchor)(request, response, next)
  response.send(body)
  return { sent: sent as string, accept: request.headers.accept, next }
}

const proofTypesOf = (sent: string) =>
  JSON.parse(sent).credential_configurations_supported['demo-credential'].proof_types_supported

const jwtOnly = { jwt: { proof_signing_alg_values_supported: ['ES256'] } }

describe('accommodateOpenId4VciKt', () => {
  it('serves JSON and an unconstrained key-attestation requirement to openid4vci-kt', () => {
    const { sent, accept, next } = runMetadataRequest(OPENID4VCI_KT_ACCEPT, metadata(jwtOnly))

    const expected = { proof_signing_alg_values_supported: ['ES256'], key_attestations_required: {} }
    expect(accept).toBe('application/json')
    expect(proofTypesOf(sent)).toEqual({ jwt: expected, attestation: expected })
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves every other client untouched, so a Credo holder still binds a plain jwk', () => {
    const json = runMetadataRequest('application/json', metadata(jwtOnly))
    const jwtOnlyClient = runMetadataRequest('application/jwt', metadata(jwtOnly))
    const absent = runMetadataRequest(undefined, metadata(jwtOnly))

    expect(proofTypesOf(json.sent)).toEqual(jwtOnly)
    expect(jwtOnlyClient.accept).toBe('application/jwt')
    expect(proofTypesOf(jwtOnlyClient.sent)).toEqual(jwtOnly)
    expect(proofTypesOf(absent.sent)).toEqual(jwtOnly)
  })

  it('never invents a proof type the issuer does not accept', () => {
    const { sent } = runMetadataRequest(OPENID4VCI_KT_ACCEPT, metadata(jwtOnly), {}, false)

    expect(Object.keys(proofTypesOf(sent))).toEqual(['jwt'])
  })

  // swiyu models proof_types_supported as a closed enum, so an `attestation` member it does not
  // know makes it throw while deserializing and the credential offer dies before it renders.
  it('keeps attestation away from every client but openid4vci-kt', () => {
    const json = runMetadataRequest('application/json', metadata(jwtOnly))
    const absent = runMetadataRequest(undefined, metadata(jwtOnly))

    expect(Object.keys(proofTypesOf(json.sent))).toEqual(['jwt'])
    expect(Object.keys(proofTypesOf(absent.sent))).toEqual(['jwt'])
  })

  it('serves plain metadata on a correctly spelled multi-range accept, without the payload change', () => {
    const swiyu = runMetadataRequest('application/json, application/jwt', metadata(jwtOnly))

    expect(swiyu.accept).toBe('application/json')
    expect(Object.keys(proofTypesOf(swiyu.sent))).toEqual(['jwt'])
  })

  it('leaves other paths, unknown proof types and non-JSON bodies alone', () => {
    expect(
      runMetadataRequest(OPENID4VCI_KT_ACCEPT, '{"plain":true}', { path: '/oid4vci/demo-did/credential' })
        .sent,
    ).toBe('{"plain":true}')
    expect(
      proofTypesOf(runMetadataRequest(OPENID4VCI_KT_ACCEPT, metadata({ ldp_vp: {} }), {}, false).sent),
    ).toEqual({
      ldp_vp: {},
    })
    expect(runMetadataRequest(OPENID4VCI_KT_ACCEPT, 'eyJhbGciOiJFUzI1NiJ9.e30.sig').sent).toBe(
      'eyJhbGciOiJFUzI1NiJ9.e30.sig',
    )
  })
})
