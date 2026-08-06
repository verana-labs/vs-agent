import type { OpenId4VcCredentialConfiguration, OpenId4VcPluginOptions } from '../types'

import { X509Certificate, X509Module } from '@credo-ts/core'
import {
  OpenId4VcModule,
  type OpenId4VciCredentialRequestToCredentialMapper,
  type OpenId4VcModuleConfigOptions,
} from '@credo-ts/openid4vc'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'

import { trustedCertificatesForVerification } from '../trust/CertificateTrust'

const ATTESTATION_AUTH_METHOD = 'attest_jwt_client_auth'
const ATTESTATION_ALGORITHMS = ['ES256']

export interface OpenId4VcIssuerRequestMapper {
  mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper
  getVctMetadata: (configurationId: string) => Record<string, unknown> | undefined
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
  if (walletAttestationEnabled) app.use(advertiseWalletAttestationMetadata)
  if (options.issuer) app.use(accommodateOpenId4VciKt)
  if (options.issuer) app.use(express.json(), acceptDraftCredentialRequests(options.credentialConfigurations))
  if (options.issuer) {
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
        getTrustedCertificatesForVerification: (_agentContext, { certificateChain, verification }) =>
          trustedCertificatesForVerification(options, {
            type: verification.type,
            certificateChain,
          }),
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

/** OpenID4VCI 1.0 dropped `format` from the credential request, so draft wallets send
 *  `{ format, vct }` and Credo answers `unsupported_credential_format`. */
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

/**
 * openid4vci-kt - the OID4VCI library inside the EUDI reference wallet - reads issuer metadata
 * more strictly than the spec requires, in two ways that no other client shares:
 *
 *   - it asks with `Accept: application/jwt; application/json`, a semicolon where a comma belongs,
 *     which parses as `application/jwt` alone and draws the signed metadata JWT it then cannot
 *     verify, since Credo signs that with a DID kid and no x5c chain;
 *   - it refuses any proof type that omits `key_attestations_required`, treating the OID4VCI 1.0
 *     optional member as mandatory.
 *
 * Both accommodations are scoped to that client, recognised by the malformed accept header it
 * sends. Advertising the member to everyone is not an option: a Credo holder that sees it stops
 * binding a plain JWK and demands a key attestation, which would break every wallet that signs
 * its own proof.
 */
export function accommodateOpenId4VciKt(request: Request, response: Response, next: NextFunction): void {
  const accept = request.headers.accept
  const isOpenId4VciKt =
    typeof accept === 'string' && accept.includes('application/jwt') && accept.includes('application/json')

  if (
    request.method !== 'GET' ||
    !request.path.includes('/.well-known/openid-credential-issuer') ||
    !isOpenId4VciKt
  ) {
    next()
    return
  }

  request.headers.accept = 'application/json'
  const send = response.send.bind(response)
  response.send = ((body?: unknown) =>
    send(typeof body === 'string' ? withKeyAttestationRequirement(body) : body)) as Response['send']
  next()
}

function withKeyAttestationRequirement(body: string): string {
  try {
    const metadata: unknown = JSON.parse(body)
    if (!isRecord(metadata) || !isRecord(metadata.credential_configurations_supported)) return body

    const configurations = Object.fromEntries(
      Object.entries(metadata.credential_configurations_supported).map(([id, configuration]) => {
        if (!isRecord(configuration) || !isRecord(configuration.proof_types_supported)) {
          return [id, configuration]
        }
        const proofTypes = Object.fromEntries(
          Object.entries(configuration.proof_types_supported).map(([type, meta]) =>
            isRecord(meta) && !('key_attestations_required' in meta) && (type === 'jwt' || type === 'attestation')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
