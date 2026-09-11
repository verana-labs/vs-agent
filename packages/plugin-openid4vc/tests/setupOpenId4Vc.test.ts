import type { OpenId4VcPluginOptions } from '../src/types'

import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'

import { createCertificateFixtures } from './helpers/certificates'

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
    credentialIssuerCertificates: ['MIIB-trusted-root'],
  },
  credentialConfigurations: [],
  verifierPolicies: [],
})

describe('setupOpenId4Vc', () => {
  it('creates a fresh non-global Express application for every setup', () => {
    const first = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    const second = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
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

  it('configures only enabled role bases', () => {
    const issuerOnly = validOptions()
    delete issuerOnly.verifier
    delete issuerOnly.trust
    const issuerSetup = setupOpenId4Vc(issuerOnly, () => ({
      getVctMetadata: () => undefined,
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    expect(issuerSetup.modules.openId4Vc.config).toHaveProperty(
      'issuer.baseUrl',
      'https://agent.example/oid4vci',
    )
    expect(issuerSetup.modules.openId4Vc.config.verifier).toBeUndefined()

    const verifierOnly = validOptions()
    delete verifierOnly.issuer
    const verifierSetup = setupOpenId4Vc(verifierOnly)

    expect(verifierSetup.modules.openId4Vc.config.issuer).toBeUndefined()
    expect(verifierSetup.modules.openId4Vc.config).toHaveProperty(
      'verifier.baseUrl',
      'https://agent.example/oid4vp',
    )
  })

  it('delegates X.509 trust only to configured trust anchors', async () => {
    const setup = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    const peerCertificate = {
      toString: () => 'MIIB-peer-certificate',
    }
    const getTrustedCertificates = setup.modules.x509.config.getTrustedCertificatesForVerification

    const anchors = await getTrustedCertificates?.({} as never, {
      certificateChain: [peerCertificate as never],
      verification: {
        type: 'credential',
        credential: {} as never,
      },
    })

    expect(anchors).toEqual(['MIIB-trusted-root'])
    expect(anchors).not.toEqual(['MIIB-peer-certificate'])
  })

  it('serves the SD-JWT VC issuer metadata that x5c-anchoring holders resolve', async () => {
    const setup = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
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
    const setup = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
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
    setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
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

  it('does not advertise wallet attestation metadata by default', async () => {
    const options = validOptions()
    options.issuer!.walletAttestationCertificates = ['unused-while-attestation-is-not-required']
    const setup = setupOpenId4Vc(options, () => ({
      getVctMetadata: () => undefined,
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

  it('advertises wallet attestation only when it is required and has trusted roots', async () => {
    const fixtures = await createCertificateFixtures()
    const options = validOptions()
    options.issuer!.requireWalletAttestation = true
    options.issuer!.walletAttestationCertificates = [fixtures.root.toString('base64')]
    const setup = setupOpenId4Vc(options, () => ({
      getVctMetadata: () => undefined,
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

  it('rejects a malformed required wallet-attestation root synchronously', async () => {
    const fixtures = await createCertificateFixtures()
    const options = validOptions()
    options.issuer!.requireWalletAttestation = true
    options.issuer!.walletAttestationCertificates = [
      fixtures.root.toString('base64'),
      'MIIB-private-attestation-material',
    ]

    expect(() =>
      setupOpenId4Vc(options, () => ({
        getVctMetadata: () => undefined,
        getSignedMetadataJwt: () => undefined,
        getJwtVcIssuerMetadata: () => ({}),
        mapCredentialRequest: () => {
          throw new Error('not implemented')
        },
      })),
    ).toThrowError(/^issuer\.walletAttestationCertificates\[1\] must be a valid X\.509 certificate$/)
  })

  it('mounts only public VCT metadata and no credential-offer or credential-exchange route', async () => {
    const setup = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: id =>
        id === 'employee'
          ? {
              vct: 'https://agent.example/oid4vc/vct/employee',
              name: 'Employee credential',
              display: [{ locale: 'en', name: 'Employee credential' }],
              claims: [{ path: ['name'] }, { path: ['role'] }],
            }
          : undefined,
      getSignedMetadataJwt: () => undefined,
      getJwtVcIssuerMetadata: () => ({}),
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    const metadata = await request(setup.publicMiddleware).get('/oid4vc/vct/employee')
    const unknown = await request(setup.publicMiddleware).get('/oid4vc/vct/unknown')
    const create = await request(setup.publicMiddleware).post('/v2/openid4vc/credential-offer').send({})
    const list = await request(setup.publicMiddleware).get('/v2/openid4vc/credential-exchanges')

    expect(metadata.status).toBe(200)
    expect(metadata.body.vct).toBe('https://agent.example/oid4vc/vct/employee')
    expect(unknown.status).toBe(404)
    expect(create.status).toBe(404)
    expect(list.status).toBe(404)
  })

  it('does not mount verifier presentation or holder routes on the public middleware', async () => {
    const setup = setupOpenId4Vc(validOptions(), () => ({
      getVctMetadata: () => undefined,
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
