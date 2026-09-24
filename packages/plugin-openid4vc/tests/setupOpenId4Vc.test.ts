import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../src/types'
import type { NextFunction, Request, Response } from 'express'

import { ClaimFormat } from '@credo-ts/core'
import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  accommodateLegacyMetadataAccept,
  acceptDraftCredentialRequests,
  setupOpenId4Vc,
} from '../src/sdk/setupOpenId4Vc'

import { createCertificateFixtures } from './helpers/certificates'

let fixtures: Awaited<ReturnType<typeof createCertificateFixtures>>

beforeAll(async () => {
  fixtures = await createCertificateFixtures()
})

const noIssuerService = (): never => {
  throw new Error('OpenID4VC issuer service is not initialized')
}

const setupOptions = (): OpenId4VcPluginOptions => ({
  publicApiBaseUrl: 'https://agent.example',
  issuer: {},
  verifier: {},
  credentialConfigurations: [],
})

describe('setupOpenId4Vc', () => {
  it('creates a fresh non-global Express application for every setup', () => {
    const first = setupOpenId4Vc(setupOptions(), () => ({
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    const second = setupOpenId4Vc(setupOptions(), () => ({
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
    const setup = setupOpenId4Vc(empty, noIssuerService)

    expect(setup.modules.openId4Vc.config).toHaveProperty('issuer.baseUrl', 'https://agent.example/oid4vci')
    expect(setup.modules.openId4Vc.config).toHaveProperty('verifier.baseUrl', 'https://agent.example/oid4vp')
  })

  it('never anchors a presented credential on the peer-provided chain', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
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
    const setup = setupOpenId4Vc(setupOptions(), noIssuerService)
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

  // RFC 8615 inserts the issuer path after the well-known segment, so the bare form alone is not enough.
  it('serves the SD-JWT VC issuer metadata at the path-inserted well-known form', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
      getJwtVcIssuerMetadata: () => ({ issuer: 'https://issuer.example', jwks: { keys: [] } }),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    const response = await request(setup.publicMiddleware).get('/.well-known/jwt-vc-issuer/oid4vci/demo-did')

    expect(response.status).toBe(200)
    expect(response.body.issuer).toBe('https://issuer.example')
  })

  // Credo advertises `client_attestation_*` and derives `token_endpoint_auth_methods_supported` from the
  // issuer record, which IssuerService fills from the same roots; openid4vcIssuance covers the served output.
  it('requires wallet attestations exactly when attestation roots are configured', () => {
    const options = setupOptions()
    options.issuer!.walletAttestationCertificates = [fixtures.root.toString('base64')]

    expect(setupOpenId4Vc(setupOptions(), noIssuerService).modules.openId4Vc.config).toHaveProperty(
      'issuer.walletAttestationsRequired',
      false,
    )
    expect(setupOpenId4Vc(options, noIssuerService).modules.openId4Vc.config).toHaveProperty(
      'issuer.walletAttestationsRequired',
      true,
    )
  })

  it('mounts no type metadata, credential-offer or credential-exchange route', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
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
    const setup = setupOpenId4Vc(setupOptions(), noIssuerService)
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
    const setup = setupOpenId4Vc(options, noIssuerService)
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

  it('leaves a body on the verifier path to the limits credo sets on its own routers', async () => {
    const setup = setupOpenId4Vc(setupOptions(), noIssuerService)
    let parsed: unknown = 'middleware was not reached'
    setup.publicMiddleware.post('/oid4vp/verifier/authorize', (incoming, response) => {
      parsed = incoming.body
      response.json({ ok: true })
    })

    const response = await request(setup.publicMiddleware)
      .post('/oid4vp/verifier/authorize')
      .send({ response: 'x'.repeat(200_000) })

    expect(response.status).toBe(200)
    expect(parsed).toBeUndefined()
  })

  it.each([
    ['https://agent.example', '/oid4vci/issuer/credential'],
    ['https://agent.example/public/base', '/public/base/oid4vci/issuer/credential'],
  ])('parses a credential request of %s above the default 100 kB limit', async (baseUrl, path) => {
    const options = setupOptions()
    options.publicApiBaseUrl = baseUrl
    const setup = setupOpenId4Vc(options, noIssuerService)
    setup.publicMiddleware.post(path, (incoming, response) =>
      response.json({ length: (incoming.body as { vct: string }).vct.length }),
    )

    const response = await request(setup.publicMiddleware)
      .post(path)
      .send({ vct: 'x'.repeat(200_000) })

    expect(response.status).toBe(200)
    expect(response.body.length).toBe(200_000)
  })

  it('does not mount verifier presentation or holder routes on the public middleware', async () => {
    const setup = setupOpenId4Vc(setupOptions(), () => ({
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

const SINGLE_RANGE_ACCEPT = 'application/jwt; application/json'

const runMetadataRequest = (accept: string | undefined, overrides: Partial<Request> = {}) => {
  const request = {
    method: 'GET',
    path: '/oid4vci/demo-did/.well-known/openid-credential-issuer',
    headers: accept === undefined ? {} : { accept },
    ...overrides,
  } as unknown as Request
  const next = vi.fn() as unknown as NextFunction
  accommodateLegacyMetadataAccept()(request, {} as Response, next)
  return { accept: request.headers.accept, next }
}

describe('accommodateLegacyMetadataAccept', () => {
  it('serves JSON to a client whose single accept range names both media types', () => {
    const { accept, next } = runMetadataRequest(SINGLE_RANGE_ACCEPT)

    expect(accept).toBe('application/json')
    expect(next).toHaveBeenCalledOnce()
  })

  it('serves JSON on a correctly spelled multi-range accept', () => {
    expect(runMetadataRequest('application/json, application/jwt').accept).toBe('application/json')
  })

  it('leaves a jwt-only, a json-only and an absent accept header untouched', () => {
    expect(runMetadataRequest('application/jwt').accept).toBe('application/jwt')
    expect(runMetadataRequest('application/json').accept).toBe('application/json')
    expect(runMetadataRequest(undefined).accept).toBeUndefined()
  })

  it('leaves another path and another method untouched', () => {
    expect(runMetadataRequest(SINGLE_RANGE_ACCEPT, { path: '/oid4vci/demo-did/credential' }).accept).toBe(
      SINGLE_RANGE_ACCEPT,
    )
    expect(runMetadataRequest(SINGLE_RANGE_ACCEPT, { method: 'POST' }).accept).toBe(SINGLE_RANGE_ACCEPT)
  })
})
