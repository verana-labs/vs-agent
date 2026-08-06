import type {
  OpenId4VcCredentialConfiguration,
  OpenId4VcPluginOptions,
} from "../types";

import { X509Certificate, X509Module } from "@credo-ts/core";
import {
  OpenId4VcModule,
  type OpenId4VciCredentialRequestToCredentialMapper,
  type OpenId4VcModuleConfigOptions,
} from "@credo-ts/openid4vc";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { trustedCertificatesForVerification } from "../trust/CertificateTrust";

const ATTESTATION_AUTH_METHOD = "attest_jwt_client_auth";
const ATTESTATION_ALGORITHMS = ["ES256"];

export interface OpenId4VcIssuerRequestMapper {
  mapCredentialRequest: OpenId4VciCredentialRequestToCredentialMapper;
  getVctMetadata: (
    configurationId: string,
  ) => Record<string, unknown> | undefined;
}

export interface OpenId4VcAgentModules {
  [key: string]: unknown;
  openId4Vc: OpenId4VcModule<null, null>;
  x509: X509Module;
}

export interface OpenId4VcSdkPlugin {
  modules: OpenId4VcAgentModules;
  publicMiddleware: Express;
}

export function setupOpenId4Vc(
  options: OpenId4VcPluginOptions,
  getIssuerService?: () => OpenId4VcIssuerRequestMapper,
): OpenId4VcSdkPlugin {
  const walletAttestationCertificates =
    options.issuer?.walletAttestationCertificates;
  const walletAttestationEnabled =
    options.issuer?.requireWalletAttestation === true &&
    Boolean(walletAttestationCertificates?.length);
  if (walletAttestationEnabled && walletAttestationCertificates) {
    assertValidWalletAttestationCertificates(walletAttestationCertificates);
  }

  const app = express();
  if (walletAttestationEnabled) app.use(advertiseWalletAttestationMetadata);
  if (options.issuer) app.use(normalizeMetadataAcceptHeader);
  if (options.issuer)
    app.use(
      express.json(),
      acceptDraftCredentialRequests(options.credentialConfigurations),
    );
  if (options.issuer) {
    app.get("/oid4vc/vct/:configurationId", (request, response, next) => {
      try {
        if (!getIssuerService)
          throw new Error("OpenID4VC issuer service is not initialized");
        const metadata = getIssuerService().getVctMetadata(
          request.params.configurationId,
        );
        if (!metadata) {
          response
            .status(404)
            .json({ message: "credential configuration not found" });
          return;
        }
        response.json(metadata);
      } catch (error) {
        next(error);
      }
    });
  }

  const moduleOptions: OpenId4VcModuleConfigOptions<null, null> = {
    // Credo declares Express 5, while VS Agent mounts the compatible Express 4 application.
    app: app as unknown as OpenId4VcModuleConfigOptions<null, null>["app"],
    ...(options.issuer
      ? {
          issuer: {
            baseUrl: `${options.publicApiBaseUrl}/oid4vci`,
            walletAttestationsRequired: walletAttestationEnabled,
            credentialRequestToCredentialMapper: (input) => {
              if (!getIssuerService) {
                throw new Error("OpenID4VC issuer service is not initialized");
              }

              return getIssuerService().mapCredentialRequest(input);
            },
          },
        }
      : {}),
    ...(options.verifier
      ? { verifier: { baseUrl: `${options.publicApiBaseUrl}/oid4vp` } }
      : {}),
  };

  return {
    modules: {
      openId4Vc: new OpenId4VcModule(moduleOptions),
      x509: new X509Module({
        getTrustedCertificatesForVerification: (
          _agentContext,
          { certificateChain, verification },
        ) =>
          trustedCertificatesForVerification(options, {
            type: verification.type,
            certificateChain,
          }),
      }),
    },
    publicMiddleware: app,
  };
}

function assertValidWalletAttestationCertificates(
  certificates: string[],
): void {
  certificates.forEach((certificate, index) => {
    try {
      X509Certificate.fromEncodedCertificate(certificate);
    } catch {
      throw new Error(
        `issuer.walletAttestationCertificates[${index}] must be a valid X.509 certificate`,
      );
    }
  });
}

/** OpenID4VCI 1.0 dropped `format` from the credential request, so draft wallets send
 *  `{ format, vct }` and Credo answers `unsupported_credential_format`. */
export function acceptDraftCredentialRequests(
  configurations: OpenId4VcCredentialConfiguration[],
) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const body: unknown = request.body;
    if (
      request.method !== "POST" ||
      !request.path.endsWith("/credential") ||
      !isRecord(body)
    ) {
      next();
      return;
    }
    if (
      body.credential_configuration_id ||
      body.credential_identifier ||
      typeof body.vct !== "string"
    ) {
      next();
      return;
    }

    const configuration = configurations.find(
      (candidate) => candidate.vct === body.vct,
    );
    if (configuration) {
      delete body.format;
      delete body.vct;
      body.credential_configuration_id = configuration.id;
    }
    next();
  };
}

/** openid4vci-kt sends `Accept: application/jwt; application/json` - a semicolon where a comma
 *  belongs - which parses as `application/jwt` alone and draws the signed metadata JWT it then
 *  cannot verify, since Credo signs it with a DID kid and no x5c chain. A client naming both
 *  formats can use either, so serve it the JSON it can read; clients that need the JWT ask for
 *  `application/jwt` alone. */
export function normalizeMetadataAcceptHeader(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const accept = request.headers.accept;
  if (
    request.method === "GET" &&
    request.path.includes("/.well-known/openid-credential-issuer") &&
    typeof accept === "string" &&
    accept.includes("application/jwt") &&
    accept.includes("application/json")
  ) {
    request.headers.accept = "application/json";
  }
  next();
}

function advertiseWalletAttestationMetadata(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    request.method !== "GET" ||
    !isAuthorizationServerMetadataPath(request.path)
  ) {
    next();
    return;
  }

  const send = response.send.bind(response);
  response.send = ((body?: unknown) =>
    send(
      typeof body === "string" ? withWalletAttestationMetadata(body) : body,
    )) as Response["send"];
  next();
}

function withWalletAttestationMetadata(body: string): string {
  try {
    const metadata: unknown = JSON.parse(body);
    if (!isRecord(metadata)) return body;

    const methods = Array.isArray(
      metadata.token_endpoint_auth_methods_supported,
    )
      ? metadata.token_endpoint_auth_methods_supported.filter(
          (method): method is string => typeof method === "string",
        )
      : [];
    if (!methods.includes(ATTESTATION_AUTH_METHOD))
      methods.push(ATTESTATION_AUTH_METHOD);

    return JSON.stringify({
      ...metadata,
      token_endpoint_auth_methods_supported: methods,
      client_attestation_signing_alg_values_supported: ATTESTATION_ALGORITHMS,
      client_attestation_pop_signing_alg_values_supported:
        ATTESTATION_ALGORITHMS,
    });
  } catch {
    return body;
  }
}

function isAuthorizationServerMetadataPath(path: string): boolean {
  return (
    path.startsWith("/.well-known/oauth-authorization-server/") ||
    path.endsWith("/.well-known/oauth-authorization-server")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
