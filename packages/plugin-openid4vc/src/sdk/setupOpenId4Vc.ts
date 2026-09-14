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
const DPOP_ALGORITHMS = ['ES256']
const COMPACT_JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/

export type IssuerMetadataSigner = (
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
) => Promise<string>

export interface OpenId4VcIssuerRequestMapper {
  mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper
  getVctMetadata: (configurationId: string) => Record<string, unknown> | undefined
  getJwtVcIssuerMetadata: () => Record<string, unknown>
  signIssuerMetadata: IssuerMetadataSigner
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

  const signIssuerMetadata: IssuerMetadataSigner | undefined = getIssuerService
    ? (header, payload) => getIssuerService().signIssuerMetadata(header, payload)
    : undefined

  const app = express()
  if (options.issuer) app.use(advertiseDpopSupport)
  if (walletAttestationEnabled) app.use(advertiseWalletAttestationMetadata)
  if (options.issuer) app.use(accommodateOpenId4VciKt(signIssuerMetadata))
  if (options.issuer) app.use(express.json(), acceptDraftCredentialRequests(options.credentialConfigurations))
  if (options.issuer) {
    // Credo serves no SD-JWT VC issuer metadata, and a wallet that anchors an x5c-signed
    // credential on the issuer origin rather than on the DID has nowhere else to look.
    // RFC 8615 puts the issuer path AFTER the well-known segment, so a holder whose issuer
    // identifier carries a path asks for `/.well-known/jwt-vc-issuer/oid4vci/<id>`. Answering
    // only the bare form makes every issuance show a metadata-fetch failure.
    app.get(['/.well-known/jwt-vc-issuer', '/.well-known/jwt-vc-issuer/*'], (_request, response, next) => {
      try {
        if (!getIssuerService) throw new Error('OpenID4VC issuer service is not initialized')
        response.json(getIssuerService().getJwtVcIssuerMetadata())
      } catch (error) {
        next(error)
      }
    })

    // Credentials carry `iss: publicApiBaseUrl`, and a holder that derives the OpenID4VCI issuer
    // metadata URL from that claim the RFC 8615 way (wwWallet does) asks for
    // `/.well-known/openid-credential-issuer` at the issuer's path, which for a root base URL is
    // the bare path. Credo only serves the issuer-scoped forms, so that request 404s and every
    // issuance is flagged with a metadata-fetch failure. One issuer per agent, so the bare path
    // can only mean that one: forward it to Credo's host-prefixed route.
    const issuerMetadataAlias = withoutTrailingSlash(
      `/.well-known/openid-credential-issuer${new URL(options.publicApiBaseUrl).pathname}`,
    )
    const issuerMetadataPath = `/.well-known/openid-credential-issuer${withoutTrailingSlash(
      new URL(`${options.publicApiBaseUrl}/oid4vci`).pathname,
    )}/${encodeURIComponent(options.issuer.id)}`
    app.get(
      ['/.well-known/openid-credential-issuer', '/.well-known/openid-credential-issuer/*'],
      (request, _response, next) => {
        if (withoutTrailingSlash(request.path) === issuerMetadataAlias) {
          request.url = `${issuerMetadataPath}${request.url.slice(request.path.length)}`
        }
        next()
      },
    )

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

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
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
 *   - it refuses a configuration that does not advertise both `jwt` and `attestation`, each with
 *     `key_attestations_required`, treating OID4VCI 1.0 optional members as mandatory.
 *
 * The payload accommodation is scoped to that client, recognised by the accept header it sends.
 * Advertising it to everyone is not an option: a Credo holder that sees `key_attestations_required`
 * stops binding a plain JWK and demands a key attestation, and swiyu models `proof_types_supported`
 * as a closed enum, so an `attestation` member makes it throw while parsing the metadata and the
 * offer dies before the wallet renders anything. Every other client therefore gets `attestation`
 * stripped, including when the issuer record carries it because a key-attestation anchor is
 * configured.
 *
 * The accept rewrite is wider: any client that offers both types can read JSON. A client asking for
 * `application/jwt` alone still receives Credo's signed metadata JWT, whose payload is the issuer
 * record itself - so the same `attestation` member has to be stripped there too, which means
 * decoding that JWT and signing the filtered payload again under an identical header.
 */
export function accommodateOpenId4VciKt(signIssuerMetadata?: IssuerMetadataSigner) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.method !== 'GET' || !request.path.includes('/.well-known/openid-credential-issuer')) {
      next()
      return
    }

    const accept = request.headers.accept
    const ranges = typeof accept === 'string' ? accept.split(',').map(range => range.trim()) : []
    const offersJson = ranges.some(range => range.includes('application/json'))
    // openid4vci-kt asks jwt then json: one malformed range up to wallet-core 0.28, two ranges from
    // 0.29. swiyu asks jwt and its ktor client appends json, so only its user agent tells them apart.
    const userAgent = request.headers['user-agent']
    const isSwiyu = typeof userAgent === 'string' && userAgent.startsWith('swiyuWallet')
    const jwtIndex = ranges.findIndex(range => range.includes('application/jwt'))
    const jsonIndex = ranges.findIndex(range => range.includes('application/json'))
    const isOpenId4VciKt =
      !isSwiyu &&
      (ranges.some(range => range.includes('application/jwt') && range.includes('application/json')) ||
        (jwtIndex >= 0 && jsonIndex > jwtIndex))
    const prefersPlainMetadata = isOpenId4VciKt || (jwtIndex >= 0 && offersJson)
    const prefersSignedMetadata = jwtIndex >= 0 && !prefersPlainMetadata

    if (prefersPlainMetadata) request.headers.accept = 'application/json'

    const rewriteProofTypes = isOpenId4VciKt ? withKeyAttestationRequirement : withoutAttestationProofType
    const send = response.send.bind(response)
    response.send = ((body?: unknown) => {
      if (typeof body !== 'string') return send(body)
      if (!prefersSignedMetadata || !signIssuerMetadata || !COMPACT_JWS.test(body)) {
        return send(rewriteProofTypes(body))
      }
      void signedWithoutAttestationProofType(body, signIssuerMetadata).then(send, next)
      return response
    }) as Response['send']
    next()
  }
}

async function signedWithoutAttestationProofType(body: string, sign: IssuerMetadataSigner): Promise<string> {
  const [header, payload] = body.split('.').map(decodeJwtSegment)
  if (!header || !payload || !advertisesAttestationProofType(payload)) return body
  return sign(header, withProofTypes(payload, withoutAttestation))
}

function decodeJwtSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    return isRecord(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function advertisesAttestationProofType(metadata: Record<string, unknown>): boolean {
  if (!isRecord(metadata.credential_configurations_supported)) return false
  return Object.values(metadata.credential_configurations_supported).some(
    configuration =>
      isRecord(configuration) &&
      isRecord(configuration.proof_types_supported) &&
      'attestation' in configuration.proof_types_supported,
  )
}

function withKeyAttestationRequirement(body: string): string {
  return rewriteProofTypesJson(body, proofTypes => {
    const attested = Object.fromEntries(
      Object.entries(proofTypes).map(([type, meta]) =>
        isRecord(meta) && (type === 'jwt' || type === 'attestation') && !('key_attestations_required' in meta)
          ? [type, { ...meta, key_attestations_required: {} }]
          : [type, meta],
      ),
    )
    return attested.jwt && !attested.attestation ? { ...attested, attestation: attested.jwt } : attested
  })
}

function withoutAttestationProofType(body: string): string {
  return rewriteProofTypesJson(body, withoutAttestation)
}

function withoutAttestation(proofTypes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(proofTypes).filter(([type]) => type !== 'attestation'))
}

function rewriteProofTypesJson(
  body: string,
  rewrite: (proofTypes: Record<string, unknown>) => Record<string, unknown>,
): string {
  try {
    const metadata: unknown = JSON.parse(body)
    if (!isRecord(metadata) || !isRecord(metadata.credential_configurations_supported)) return body
    return JSON.stringify(withProofTypes(metadata, rewrite))
  } catch {
    return body
  }
}

function withProofTypes(
  metadata: Record<string, unknown>,
  rewrite: (proofTypes: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(metadata.credential_configurations_supported)) return metadata

  const configurations = Object.fromEntries(
    Object.entries(metadata.credential_configurations_supported).map(([id, configuration]) =>
      isRecord(configuration) && isRecord(configuration.proof_types_supported)
        ? [id, { ...configuration, proof_types_supported: rewrite(configuration.proof_types_supported) }]
        : [id, configuration],
    ),
  )
  return { ...metadata, credential_configurations_supported: configurations }
}

/** Credo omits `dpop_signing_alg_values_supported`. wwWallet reads the absent member and then
 *  dereferences its DPoP params unconditionally, throwing before any consent screen renders. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
