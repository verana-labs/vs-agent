import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../types'

import { X509Certificate, X509Module } from '@credo-ts/core'
import {
  OpenId4VcModule,
  type OpenId4VciCredentialRequestToCredentialMapper,
  type OpenId4VcModuleConfigOptions,
} from '@credo-ts/openid4vc'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'

import { assertCredentialExpires } from '../services/presentationVerification'
import { trustedCertificatesForVerification } from '../trust/CertificateTrust'
import { isRecord } from '../utils/isRecord'

const ATTESTATION_AUTH_METHOD = 'attest_jwt_client_auth'
const ATTESTATION_ALGORITHMS = ['ES256']
const DPOP_ALGORITHMS = ['ES256']

export interface OpenId4VcIssuerRequestMapper {
  mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper
  getVctMetadata: (configurationId: string) => Record<string, unknown> | undefined
  getJwtVcIssuerMetadata: () => Record<string, unknown>
  getSignedMetadataJwt: () => string | undefined
}

export interface OpenId4VcAgentModules {
  [key: string]: unknown
  openId4Vc: OpenId4VcModule<null, null>
  x509: X509Module
}

export interface OpenId4VcSdkPlugin {
  modules: OpenId4VcAgentModules
  publicMiddleware: Express
}

export function setupOpenId4Vc(
  options: OpenId4VcPluginOptions,
  getIssuerService?: () => OpenId4VcIssuerRequestMapper,
): OpenId4VcSdkPlugin {
  const walletAttestationCertificates = options.issuer?.walletAttestationCertificates
  const walletAttestationEnabled =
    options.issuer?.requireWalletAttestation === true && Boolean(walletAttestationCertificates?.length)
  if (walletAttestationEnabled && walletAttestationCertificates) {
    assertValidWalletAttestationCertificates(walletAttestationCertificates)
  }

  const app = express()
  if (options.issuer) app.use(advertiseDpopSupport)
  if (walletAttestationEnabled) app.use(advertiseWalletAttestationMetadata)
  if (options.issuer)
    app.use(accommodateOpenId4VciKt(Boolean(options.issuer.keyAttestationCertificates?.length)))
  if (options.issuer) app.use(serveCertificateBoundIssuerMetadata(getIssuerService))
  if (options.issuer) app.use(express.json(), acceptDraftCredentialRequests(options.credentialConfigurations))
  if (options.issuer) {
    // RFC 8615 puts the issuer path after the well-known segment, so a holder whose issuer identifier carries a path requests `/.well-known/jwt-vc-issuer/oid4vci/<id>`, not just the bare form.
    app.get(['/.well-known/jwt-vc-issuer', '/.well-known/jwt-vc-issuer/*'], (_request, response, next) => {
      try {
        if (!getIssuerService) throw new Error('OpenID4VC issuer service is not initialized')
        response.json(getIssuerService().getJwtVcIssuerMetadata())
      } catch (error) {
        next(error)
      }
    })

    app.get('/oid4vc/vct/:configurationId', (request, response, next) => {
      try {
        if (!getIssuerService) throw new Error('OpenID4VC issuer service is not initialized')
        const metadata = getIssuerService().getVctMetadata(request.params.configurationId)
        if (!metadata) {
          response.status(404).json({ message: 'credential configuration not found' })
          return
        }
        response.json(metadata)
      } catch (error) {
        next(error)
      }
    })
  }

  const moduleOptions: OpenId4VcModuleConfigOptions<null, null> = {
    // Credo declares Express 5, while VS Agent mounts the compatible Express 4 application.
    app: app as unknown as OpenId4VcModuleConfigOptions<null, null>['app'],
    ...(options.issuer
      ? {
          issuer: {
            baseUrl: `${options.publicApiBaseUrl}/oid4vci`,
            walletAttestationsRequired: walletAttestationEnabled,
            credentialRequestToCredentialMapper: input => {
              if (!getIssuerService) {
                throw new Error('OpenID4VC issuer service is not initialized')
              }

              return getIssuerService().mapCredentialRequest(input)
            },
          },
        }
      : {}),
    ...(options.verifier ? { verifier: { baseUrl: `${options.publicApiBaseUrl}/oid4vp` } } : {}),
  }

  return {
    modules: {
      openId4Vc: new OpenId4VcModule(moduleOptions),
      x509: new X509Module({
        getTrustedCertificatesForVerification: (_agentContext, { certificateChain, verification }) => {
          // Credo accepts an SD-JWT VC without `exp`, and this callback is the only hook inside its presentation verification.
          if (verification.type === 'credential') assertCredentialExpires(verification.credential)
          return trustedCertificatesForVerification(options, {
            type: verification.type,
            certificateChain,
          })
        },
      }),
    },
    publicMiddleware: app,
  }
}

function assertValidWalletAttestationCertificates(certificates: string[]): void {
  certificates.forEach((certificate, index) => {
    try {
      X509Certificate.fromEncodedCertificate(certificate)
    } catch {
      throw new Error(`issuer.walletAttestationCertificates[${index}] must be a valid X.509 certificate`)
    }
  })
}

// Draft wallets predating OpenID4VCI 1.0 still send `format` alongside `vct` on the credential request, which Credo answers with `unsupported_credential_format`.
export function acceptDraftCredentialRequests(configurations: OpenId4VcCredentialConfiguration[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const body: unknown = request.body
    if (request.method !== 'POST' || !request.path.endsWith('/credential') || !isRecord(body)) {
      next()
      return
    }
    if (body.credential_configuration_id || body.credential_identifier || typeof body.vct !== 'string') {
      next()
      return
    }

    const configuration = configurations.find(candidate => candidate.vct === body.vct)
    if (configuration) {
      delete body.format
      delete body.vct
      body.credential_configuration_id = configuration.id
    }
    next()
  }
}

// openid4vci-kt (the EUDI reference wallet) sends `Accept: application/jwt; application/json` and requires `key_attestations_required` on every proof type, both outside what the spec mandates.
export function accommodateOpenId4VciKt(hasKeyAttestationAnchor: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const accept = request.headers.accept
    const ranges = typeof accept === 'string' ? accept.split(',') : []
    const isOpenId4VciKt = ranges.some(
      range => range.includes('application/jwt') && range.includes('application/json'),
    )
    const prefersPlainMetadata =
      isOpenId4VciKt ||
      (ranges.some(range => range.includes('application/jwt')) &&
        ranges.some(range => range.includes('application/json')))

    if (
      request.method !== 'GET' ||
      !request.path.includes('/.well-known/openid-credential-issuer') ||
      !prefersPlainMetadata
    ) {
      next()
      return
    }

    request.headers.accept = 'application/json'
    if (!isOpenId4VciKt) {
      next()
      return
    }

    const send = response.send.bind(response)
    response.send = ((body?: unknown) =>
      send(
        typeof body === 'string' ? withKeyAttestationRequirement(body, hasKeyAttestationAnchor) : body,
      )) as Response['send']
    next()
  }
}

// NL Wallet's core rejects a metadata JWT signed with `kid` and no `x5c`, so this serves the copy IssuerService re-signs under both.
export function serveCertificateBoundIssuerMetadata(getIssuerService?: () => OpenId4VcIssuerRequestMapper) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      request.method !== 'GET' ||
      !request.path.includes('/.well-known/openid-credential-issuer') ||
      !acceptsSignedMetadataOnly(request.headers.accept)
    ) {
      next()
      return
    }

    const signedMetadataJwt = getIssuerService?.().getSignedMetadataJwt()
    if (!signedMetadataJwt) {
      next()
      return
    }

    response.type('application/jwt').status(200).send(signedMetadataJwt)
  }
}

function acceptsSignedMetadataOnly(accept: string | string[] | undefined): boolean {
  const ranges = typeof accept === 'string' ? accept.split(',') : []
  return (
    ranges.some(range => range.includes('application/jwt')) &&
    !ranges.some(range => range.includes('application/json'))
  )
}

function withKeyAttestationRequirement(body: string, hasKeyAttestationAnchor: boolean): string {
  try {
    const metadata: unknown = JSON.parse(body)
    if (!isRecord(metadata) || !isRecord(metadata.credential_configurations_supported)) return body

    const configurations = Object.fromEntries(
      Object.entries(metadata.credential_configurations_supported).map(([id, configuration]) => {
        if (!isRecord(configuration) || !isRecord(configuration.proof_types_supported)) {
          return [id, configuration]
        }
        const advertised = hasKeyAttestationAnchor
          ? {
              ...configuration.proof_types_supported,
              attestation: { proof_signing_alg_values_supported: ['ES256'] },
            }
          : configuration.proof_types_supported
        const proofTypes = Object.fromEntries(
          Object.entries(advertised).map(([type, meta]) =>
            isRecord(meta) &&
            !('key_attestations_required' in meta) &&
            (type === 'jwt' || type === 'attestation')
              ? [type, { ...meta, key_attestations_required: {} }]
              : [type, meta],
          ),
        )
        return [id, { ...configuration, proof_types_supported: proofTypes }]
      }),
    )
    return JSON.stringify({ ...metadata, credential_configurations_supported: configurations })
  } catch {
    return body
  }
}

// wwWallet dereferences `dpop_signing_alg_values_supported` unconditionally and throws before rendering consent when Credo omits it.
function advertiseDpopSupport(request: Request, response: Response, next: NextFunction): void {
  if (request.method !== 'GET' || !isAuthorizationServerMetadataPath(request.path)) {
    next()
    return
  }

  const send = response.send.bind(response)
  response.send = ((body?: unknown) =>
    send(typeof body === 'string' ? withDpopAlgorithms(body) : body)) as Response['send']
  next()
}

function withDpopAlgorithms(body: string): string {
  try {
    const metadata: unknown = JSON.parse(body)
    if (!isRecord(metadata) || metadata.dpop_signing_alg_values_supported) return body
    return JSON.stringify({ ...metadata, dpop_signing_alg_values_supported: DPOP_ALGORITHMS })
  } catch {
    return body
  }
}

function advertiseWalletAttestationMetadata(request: Request, response: Response, next: NextFunction): void {
  if (request.method !== 'GET' || !isAuthorizationServerMetadataPath(request.path)) {
    next()
    return
  }

  const send = response.send.bind(response)
  response.send = ((body?: unknown) =>
    send(typeof body === 'string' ? withWalletAttestationMetadata(body) : body)) as Response['send']
  next()
}

function withWalletAttestationMetadata(body: string): string {
  try {
    const metadata: unknown = JSON.parse(body)
    if (!isRecord(metadata)) return body

    const methods = Array.isArray(metadata.token_endpoint_auth_methods_supported)
      ? metadata.token_endpoint_auth_methods_supported.filter(
          (method): method is string => typeof method === 'string',
        )
      : []
    if (!methods.includes(ATTESTATION_AUTH_METHOD)) methods.push(ATTESTATION_AUTH_METHOD)

    return JSON.stringify({
      ...metadata,
      token_endpoint_auth_methods_supported: methods,
      client_attestation_signing_alg_values_supported: ATTESTATION_ALGORITHMS,
      client_attestation_pop_signing_alg_values_supported: ATTESTATION_ALGORITHMS,
    })
  } catch {
    return body
  }
}

function isAuthorizationServerMetadataPath(path: string): boolean {
  return (
    path.startsWith('/.well-known/oauth-authorization-server/') ||
    path.endsWith('/.well-known/oauth-authorization-server')
  )
}
