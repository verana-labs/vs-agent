import type { OpenId4VcPluginOptions } from '../types'

import { X509Module } from '@credo-ts/core'
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
}

export interface OpenId4VcAgentModules {
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
  const app = express()
  const walletAttestationEnabled =
    options.issuer?.requireWalletAttestation === true &&
    Boolean(options.issuer.walletAttestationCertificates?.length)

  if (walletAttestationEnabled) app.use(advertiseWalletAttestationMetadata)

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
