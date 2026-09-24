import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
  OpenId4VcVsAgentModules,
} from '../types'

import { X509Module } from '@credo-ts/core'
import {
  OpenId4VcModule,
  type OpenId4VciCredentialRequestToCredentialMapper,
  type OpenId4VcModuleConfigOptions,
} from '@credo-ts/openid4vc'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'

import { ISSUER_CAPABILITY_ID } from '../config'
import { assertCredentialExpires } from '../services/presentationVerification'
import { trustedCertificatesForVerification } from '../trust/CertificateTrust'
import { isRecord } from '../utils/isRecord'

const ISSUER_BODY_LIMIT = '1mb'

export interface OpenId4VcIssuerRequestMapper {
  mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper
  getJwtVcIssuerMetadata: () => Record<string, unknown>
}

export type OpenId4VcAgentModules = Pick<OpenId4VcVsAgentModules, 'openId4Vc' | 'x509'>

export interface OpenId4VcSdkPlugin {
  modules: OpenId4VcAgentModules
  publicMiddleware: Express
}

export function setupOpenId4Vc(
  options: OpenId4VcPluginOptions,
  getIssuerService: () => OpenId4VcIssuerRequestMapper,
): OpenId4VcSdkPlugin {
  const walletAttestationEnabled = Boolean(options.issuer?.walletAttestationCertificates?.length)

  const app = express()
  app.use(accommodateLegacyMetadataAccept(Boolean(options.issuer?.keyAttestationCertificates?.length)))
  // Credo raises the body limits of its own routers (1 MB issuer, 5 MB verifier), and a parser registered on
  // the same app before them decides first, so this one covers the issuer path alone and at the limit credo
  // sets there.
  app.use(
    new URL(`${options.publicApiBaseUrl}/oid4vci`).pathname,
    express.json({ limit: ISSUER_BODY_LIMIT }),
    acceptDraftCredentialRequests(options.credentialConfigurations),
  )
  // RFC 8615 puts the issuer path after the well-known segment, so a holder whose issuer identifier carries a
  // path requests `/.well-known/jwt-vc-issuer/oid4vci/<id>`, not just the bare form.
  app.get(['/.well-known/jwt-vc-issuer', '/.well-known/jwt-vc-issuer/*'], (_request, response, next) => {
    try {
      response.json(getIssuerService().getJwtVcIssuerMetadata())
    } catch (error) {
      next(error)
    }
  })

  aliasBareWellKnownPath(app, '/.well-known/openid-credential-issuer', options.publicApiBaseUrl)
  aliasBareWellKnownPath(app, '/.well-known/oauth-authorization-server', options.publicApiBaseUrl)

  const moduleOptions: OpenId4VcModuleConfigOptions<null, null> = {
    // Credo declares Express 5, while VS Agent mounts the compatible Express 4 application.
    app: app as unknown as OpenId4VcModuleConfigOptions<null, null>['app'],
    issuer: {
      baseUrl: `${options.publicApiBaseUrl}/oid4vci`,
      walletAttestationsRequired: walletAttestationEnabled,
      credentialRequestToCredentialMapper: input => getIssuerService().mapCredentialRequest(input),
    },
    verifier: { baseUrl: `${options.publicApiBaseUrl}/oid4vp` },
  }

  return {
    modules: {
      openId4Vc: new OpenId4VcModule(moduleOptions),
      x509: new X509Module({
        getTrustedCertificatesForVerification: (_agentContext, { verification }) => {
          // Credo accepts an SD-JWT VC without `exp`, and this callback is the only hook inside its
          // presentation verification.
          if (verification.type === 'credential') assertCredentialExpires(verification.credential)
          return trustedCertificatesForVerification(options, verification.type)
        },
      }),
    },
    publicMiddleware: app,
  }
}

// A credential carries `iss: publicApiBaseUrl`, and a wallet deriving the metadata URL from it the RFC 8615
// way asks for the bare path, which credo only serves under the issuer-scoped route.
function aliasBareWellKnownPath(app: Express, wellKnown: string, publicApiBaseUrl: string): void {
  const alias = withoutTrailingSlash(`${wellKnown}${new URL(publicApiBaseUrl).pathname}`)
  const issuerScopedPath = `${wellKnown}${withoutTrailingSlash(
    new URL(`${publicApiBaseUrl}/oid4vci`).pathname,
  )}/${encodeURIComponent(ISSUER_CAPABILITY_ID)}`

  app.get([wellKnown, `${wellKnown}/*`], (request, _response, next) => {
    if (withoutTrailingSlash(request.path) === alias) {
      request.url = `${issuerScopedPath}${request.url.slice(request.path.length)}`
    }
    next()
  })
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

// Draft wallets predating OpenID4VCI 1.0 still send `format` alongside `vct` on the credential request, which
// Credo answers with `unsupported_credential_format`.
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
      const { format: _format, vct: _vct, ...rest } = body
      request.body = { ...rest, credential_configuration_id: configuration.id }
    }
    next()
  }
}

// `application/jwt; application/json` parses as a single `application/jwt` range with a parameter, so credo
// would answer signed metadata to a client that reads JSON alone.
export function accommodateLegacyMetadataAccept(hasKeyAttestationAnchor: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const accept = request.headers.accept
    const ranges = typeof accept === 'string' ? accept.split(',') : []
    const isSingleRange = ranges.some(
      range => range.includes('application/jwt') && range.includes('application/json'),
    )
    const prefersPlainMetadata =
      isSingleRange ||
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
    if (!isSingleRange || !hasKeyAttestationAnchor) {
      next()
      return
    }

    const send = response.send.bind(response)
    response.send = ((body?: unknown) =>
      send(typeof body === 'string' ? withAttestationProofType(body) : body)) as Response['send']
    next()
  }
}

// `attestation` stays off the issuer record because a wallet modelling `proof_types_supported` as a closed
// enum throws on a member it does not know, which kills the offer before it renders.
function withAttestationProofType(body: string): string {
  try {
    const metadata: unknown = JSON.parse(body)
    if (!isRecord(metadata) || !isRecord(metadata.credential_configurations_supported)) return body

    const configurations = Object.fromEntries(
      Object.entries(metadata.credential_configurations_supported).map(([id, configuration]) => {
        if (!isRecord(configuration) || !isRecord(configuration.proof_types_supported)) {
          return [id, configuration]
        }
        const jwtProofType = configuration.proof_types_supported.jwt
        if (!isRecord(jwtProofType)) return [id, configuration]

        return [
          id,
          {
            ...configuration,
            proof_types_supported: {
              ...configuration.proof_types_supported,
              attestation: jwtProofType,
            },
          },
        ]
      }),
    )
    return JSON.stringify({ ...metadata, credential_configurations_supported: configurations })
  } catch {
    return body
  }
}
