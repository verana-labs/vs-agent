import type { OpenId4VcPluginOptions } from '../src/types'

import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { setupOpenId4Vc } from '../src/sdk/setupOpenId4Vc'

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
    credentialIssuerCertificates: ['MIIB-trusted-root'],
  },
  credentialConfigurations: [],
  verifierPolicies: [],
})

describe('setupOpenId4Vc', () => {
  it('creates a fresh non-global Express application for every setup', () => {
    const first = setupOpenId4Vc(validOptions(), () => ({
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))
    const second = setupOpenId4Vc(validOptions(), () => ({
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
      mapCredentialRequest: () => {
        throw new Error('not implemented')
      },
    }))

    expect(issuerSetup.modules.openId4Vc.config.issuer?.baseUrl).toBe('https://agent.example/oid4vci')
    expect(issuerSetup.modules.openId4Vc.config.verifier).toBeUndefined()

    const verifierOnly = validOptions()
    delete verifierOnly.issuer
    const verifierSetup = setupOpenId4Vc(verifierOnly)

    expect(verifierSetup.modules.openId4Vc.config.issuer).toBeUndefined()
    expect(verifierSetup.modules.openId4Vc.config.verifier?.baseUrl).toBe('https://agent.example/oid4vp')
  })

  it('delegates X.509 trust only to configured trust anchors', async () => {
    const setup = setupOpenId4Vc(validOptions(), () => ({
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

  it('does not advertise wallet attestation metadata by default', async () => {
    const setup = setupOpenId4Vc(validOptions(), () => ({
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
    expect(setup.modules.openId4Vc.config.issuer?.walletAttestationsRequired).toBe(false)
  })

  it('advertises wallet attestation only when it is required and has trusted roots', async () => {
    const options = validOptions()
    options.issuer!.requireWalletAttestation = true
    options.issuer!.walletAttestationCertificates = ['MIIB-wallet-root']
    const setup = setupOpenId4Vc(options, () => ({
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
    expect(setup.modules.openId4Vc.config.issuer?.walletAttestationsRequired).toBe(true)
  })
})
