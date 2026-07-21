# OpenID4VC plugin

`@verana-labs/vs-agent-plugin-openid4vc` adds an optional OpenID4VCI issuer and OpenID4VP verifier to VS Agent.

The implemented foundation is deliberately narrow:

- pre-authorized OpenID4VCI issuance of `dc+sd-jwt` credentials;
- DCQL OpenID4VP requests using `direct_post.jwt` and the `x509_hash` client identifier scheme;
- internal admin routes for creating offers and verification requests and reading their state;
- public wallet protocol and metadata routes only;
- certificate, DID-key, and Verana authorization checks before a presentation is accepted.

This is implementation groundwork, not EUDI certification or a claim of complete HAIP support. W3C VCDM credentials, ISO mdoc, status lists, authorization-code issuance, and production PKI onboarding are outside this foundation. See [OpenID4VC follow-up scope](../../docs/openid4vc-w3c-follow-up.md).

## Configure VS Agent

Use the `vs-agent-openid4vc` image target. It enables `messaging,chat,openid4vc` and requires `OID4VC_CONFIG_FILE`:

The commands below explicitly select the Colima Docker context. Omit `--context colima` when the active Docker context already points to the intended engine.

```bash
docker --context colima build \
  --target vs-agent-openid4vc \
  -t vs-agent-openid4vc:dev \
  -f apps/vs-agent/Dockerfile .

docker --context colima run --rm \
  --env-file ./env-vars \
  -e OID4VC_CONFIG_FILE=/run/config/openid4vc.json \
  -v "$PWD/openid4vc.json:/run/config/openid4vc.json:ro" \
  -p 3000:3000 \
  -p 3001:3001 \
  vs-agent-openid4vc:dev
```

Run both commands from the monorepo root. `env-vars` must set an HTTPS `PUBLIC_API_BASE_URL`, an `AGENT_PUBLIC_DID`, and the normal VS Agent wallet and deployment settings. The JSON file must not contain `publicApiBaseUrl`; VS Agent injects the trusted value from `PUBLIC_API_BASE_URL`. An HTTPS base path is supported and is used verbatim when composing protocol URLs. URLs containing a username or password are rejected.

### Development configuration

This complete `openid4vc.json` shape passes the current configuration validator. The all-zero fingerprint is intentionally redacted and will trust no real peer. Replace it with the exact lowercase SHA-256 fingerprint of the self-signed issuer leaf before testing presentation:

```json
{
  "issuer": {
    "id": "development-issuer",
    "displayName": "Development Issuer",
    "signing": {
      "development": {
        "enabled": true,
        "commonName": "Local OpenID4VC Issuer"
      }
    }
  },
  "verifier": {
    "id": "development-verifier",
    "displayName": "Development Verifier",
    "signing": {
      "development": {
        "enabled": true,
        "commonName": "Local OpenID4VC Verifier"
      }
    }
  },
  "trust": {
    "resolverUrl": "https://resolver.example/v1/trust",
    "timeoutMs": 5000,
    "allowedDidWebHosts": ["issuer.example"],
    "credentialIssuerCertificates": [],
    "developmentCertificateFingerprints": [
      "SHA256:0000000000000000000000000000000000000000000000000000000000000000"
    ]
  },
  "credentialConfigurations": [
    {
      "id": "employee",
      "format": "dc+sd-jwt",
      "vct": "https://agent.example/oid4vc/vct/employee",
      "name": "Employee credential",
      "description": "Development employee credential",
      "vtjscId": "https://trust.example/vtjsc/employee",
      "claims": ["given_name", "family_name", "role"],
      "disclosureFrame": ["given_name", "family_name", "role"],
      "ttlSeconds": 3600
    }
  ],
  "verifierPolicies": [
    {
      "id": "employee-check",
      "credentialConfigurationId": "employee",
      "requestedClaims": ["given_name", "family_name", "role"]
    }
  ]
}
```

Development signing generates and persists a self-signed P-256 certificate for each role, with a DNS SAN derived from `PUBLIC_API_BASE_URL` and a DID URI SAN derived from `AGENT_PUBLIC_DID`.

The certificate still requires both bindings:

- its exact fingerprint must be configured by every verifier that accepts it;
- its public key must be present in the DID document under `assertionMethod` for issuance and `authentication` for verifier request signing.

A pin does not replace DID key binding or Verana authorization. Development signing is unsuitable for production and is not a HAIP deployment mode.

### Production signing and trust

Configured signing material uses a non-self-signed leaf, followed by any intermediates and the root. The private JWK must be the P-256 key matching the leaf. The values below are redacted and must be supplied through a secret-managed, read-only configuration file:

```json
{
  "signing": {
    "configured": {
      "certificateChain": [
        "MIIB...REDACTED_LEAF_BASE64...",
        "MIIC...REDACTED_INTERMEDIATE_BASE64...",
        "MIIC...REDACTED_ROOT_BASE64..."
      ],
      "privateJwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "REDACTED",
        "y": "REDACTED",
        "d": "REDACTED",
        "alg": "ES256",
        "kid": "issuer-signing-key"
      }
    }
  },
  "trust": {
    "resolverUrl": "https://resolver.example/v1/trust",
    "timeoutMs": 5000,
    "allowedDidWebHosts": ["issuer.example"],
    "credentialIssuerCertificates": ["MIIC...REDACTED_TRUSTED_ROOT_BASE64..."]
  }
}
```

Apply the `signing` object under `issuer`, `verifier`, or both. Each leaf must contain the agent DID as a URI SAN, and its key must match the relevant DID relationship. `credentialIssuerCertificates` contains verifier trust anchors, not peer-supplied chains. Each entry must parse as a currently valid, self-issued CA root with `keyCertSign`; duplicate roots are rejected. Do not put private JWKs in source control, logs, image layers, or public metadata.

`allowedDidWebHosts` is the explicit network trust boundary for issuer DIDs read from verified certificates. Only exact `did:web` and `did:webvh` hosts on this operator-managed list are resolved. Do not populate it from a peer request or certificate. Credo owns the underlying fetch and redirect behavior, so an allowlisted host must have operator-trusted DNS and redirect behavior. Loopback, private, link-local, and unsupported DID targets are rejected before Credo resolution. Resolution returns after at most `timeoutMs`, which must not exceed 30000 milliseconds. The agent's own DID host is derived from `AGENT_PUBLIC_DID` and does not need to be repeated in this list.

### Configuration reference

| Field                             | Requirement                                                                                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer`                          | Optional when `verifier` is present. Defines `id`, `displayName`, and exactly one signing mode.                                                                                                                                              |
| `issuer.requireWalletAttestation` | Optional. When `true`, `walletAttestationCertificates` must contain locally configured X.509 roots. Trust-list distribution is not implemented.                                                                                              |
| `verifier`                        | Optional when `issuer` is present. Defines `id`, `displayName`, and exactly one signing mode.                                                                                                                                                |
| `trust`                           | Required by the verifier. Defines the HTTPS Verana resolver, a 1–30000 ms resolver timeout, exact allowed issuer DID web hosts, valid issuer CA roots, and optional development leaf fingerprints in `SHA256:` plus 64 lowercase hex format. |
| `credentialConfigurations`        | Array of stable IDs, `dc+sd-jwt` format, VCT and VTJSC URLs, display fields, allowed claims, disclosure frame, and a 60–31,536,000 second lifetime.                                                                                          |
| `verifierPolicies`                | Array mapping a policy ID to one credential configuration and a subset of its claims.                                                                                                                                                        |

Claims named `vct`, `iat`, `exp`, `iss`, or `cnf` are reserved for the credential envelope and cannot be configured.

## Route ownership

The control and protocol surfaces are intentionally separate.

| Surface        | Method and path                                                                           | Owner and purpose                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal admin | `POST /v1/oid4vc/offers`                                                                  | Plugin controller. Creates a pre-authorized offer from `credentialConfigurationId` and all configured claims.                                                                |
| Internal admin | `GET /v1/oid4vc/offers/:id`                                                               | Plugin controller. Returns safe issuance state only.                                                                                                                         |
| Internal admin | `POST /v1/oid4vc/verifier/requests`                                                       | Plugin controller. Creates a request from `policyId`.                                                                                                                        |
| Internal admin | `GET /v1/oid4vc/verifier/sessions/:id`                                                    | Plugin controller. Returns protocol state and the bounded trust result.                                                                                                      |
| Public         | `GET /oid4vc/vct/:configurationId`                                                        | Plugin route. Returns configured SD-JWT VC type metadata.                                                                                                                    |
| Public         | dynamic paths below `/.well-known/*`, `/oid4vci/:issuerId/*`, and `/oid4vp/:verifierId/*` | Pinned Credo router. Serves issuer/OAuth metadata, returned offer and request URIs, and wallet token, credential, authorization-request, and authorization-response traffic. |

Credo derives protocol paths from its current route configuration and record IDs. Wallets should follow the URIs returned by the admin API and metadata rather than constructing undocumented paths.

The four admin routes have the default `INTERNAL` access mode. They are absent from the public listener and unavailable through the corporation bearer-authenticated listener. The internal listener is network-trusted by default, so production deployments must isolate it or place it behind an authenticated reverse proxy. Credential offers are bearer capabilities and must not be logged or exposed through a public convenience endpoint.

## Trust decision

A verifier accepts a presentation only after this sequence succeeds:

1. Credo verifies the OpenID4VP response, nonce, audience, holder binding, SD-JWT disclosure, signature, and X.509 chain against configured roots or an exact development leaf pin.
2. The plugin reads a DID only from a URI SAN after X.509 validation succeeds.
3. Before network resolution, the DID must be a well-formed `did:web` or `did:webvh` on the operator allowlist, with no loopback, private, or link-local target. The resolved document ID must exactly match the requested DID.
4. The certificate public key must match a verification method authorized by that DID document under `assertionMethod`. The plugin uses `authentication` for its own verifier request-signing certificate during startup.
5. The Verana resolver must return `TRUSTED` for the issuer DID and authorize that issuer for the credential configuration's `vtjscId`.
6. The result is accepted only for the exact `TRUSTED_AUTHORIZED` verdict.

Missing or invalid chains, SAN errors, key mismatch, unresolvable DIDs, resolver timeout, malformed responses, non-`TRUSTED` status, and missing authorization all fail closed.

## Verification evidence

| Path                                                    | Evidence                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned Credo `0.7.1-pr-2704-20260630143332`, in process | Automated issuance and presentation tests cover a pre-authorized offer, holder-bound `dc+sd-jwt`, DCQL, `x509_hash`, `direct_post.jwt`, `TRUSTED_AUTHORIZED` acceptance, DID-key mismatch, unauthorized issuers, resolver failure, and response replay. |
| Android or EUDI wallet                                  | No live result, wallet version, or date is recorded for this foundation branch.                                                                                                                                                                         |
| Official online interoperability tools                  | No result is recorded for this foundation branch.                                                                                                                                                                                                       |

The automated path proves behavior between local Credo agents. It is not external-wallet evidence or formal conformance evidence.
