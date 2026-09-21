# OpenID4VC

`@verana-labs/vs-agent-plugin-openid4vc` gives VS Agent an OpenID4VCI issuer and an OpenID4VP
verifier for `dc+sd-jwt` credentials. It ships in every `vs-agent` image and turns on when the
operator sets `OID4VC_CONFIG_FILE_LOCATION`. Nothing else enables it.

What it does:

- pre-authorized OpenID4VCI issuance of `dc+sd-jwt` credentials, valid until they expire: v4
  specifies no revocation for this format, so a credential carries no `status` claim and the
  `ttlSeconds` of its offer is its only bound;
- OpenID4VP requests in DCQL (`direct_post.jwt`, `x509_hash` or DID client identifier) or, for a
  wallet that predates DCQL, Presentation Exchange (`direct_post`);
- the `/v2/openid4vc` Administration API scope: create an offer or a request, then list, read
  and delete;
- a fail-closed trust decision before a presentation is accepted: certificate chain, DID key
  binding, Verana resolver status and issuer authorization.

Out of scope, and not implied: W3C VCDM credentials, ISO mdoc, authorization-code issuance,
wallet-attestation trust-list distribution, production PKI onboarding, formal conformance.

## Enable it

```bash
docker run --rm \
  --env-file ./env-vars \
  -e OID4VC_CONFIG_FILE_LOCATION=/run/config/openid4vc.json \
  -v "$PWD/openid4vc.json:/run/config/openid4vc.json:ro" \
  -p 3000:3000 -p 3001:3001 \
  veranalabs/vs-agent
```

`env-vars` carries the normal VS Agent settings, with an `https://` `PUBLIC_API_BASE_URL`. The
JSON file must not contain `publicApiBaseUrl`; the agent injects the trusted value. The location
can also be an `https://` URL, which the agent fetches once at startup without following a
redirect. With Helm, put the JSON in `oid4vc.config`.

## Configuration file

The agent reads and validates the file at startup, and refuses to start when it cannot read the
location or validation fails. Keys are camelCase. Full reference: [[VSA-VTI-CFG-ENV-OID]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-oid-openid4vc).

Every key is OPTIONAL and `{}` is a valid file. The agent runs both capabilities whenever
`OID4VC_CONFIG_FILE_LOCATION` is set; the file only carries what the agent cannot derive by
itself.

| Key | Requirement |
| --- | --- |
| `issuer` | OPTIONAL. Holds `signing`, `walletAttestationCertificates` and `keyAttestationCertificates`, each OPTIONAL. |
| `issuer.walletAttestationCertificates` | X.509 roots of the accepted wallet providers. When non-empty, the agent requires a wallet attestation. |
| `issuer.keyAttestationCertificates` | Roots for OpenID4VCI key attestations. Absent, the `attestation` proof type is neither advertised nor accepted. |
| `verifier` | OPTIONAL. Holds an OPTIONAL `signing`. |

The identifier segment of each capability is fixed: `issuer` and `verifier`, so the public paths
read `/oid4vci/issuer/...` and `/oid4vp/verifier/...`. The file declares neither, and the agent
refuses to start on an `issuer.id` or a `verifier.id`, as it does on any other unknown key.

The display name and the logo the agent publishes come from the ECS Service credential it holds
about its own DID; no key of the file overrides them.

### Signing modes

**Development signing** (`signing` absent): the agent generates and persists a self-signed P-256
certificate for the capability, with a common name and a DNS SAN derived from
`PUBLIC_API_BASE_URL` and a DID URI SAN with the agent DID, and publishes the public key in its
DID Document before it completes startup (`assertionMethod` for the issuer, `authentication` for
the verifier). A peer verifier still has to pin the fingerprint that
`GET /v2/openid4vc/signing-certificates` returns. Unsuitable for production.

**Configured signing** (`signing.configured`): `certificateChain` (a non-self-signed leaf first,
then the intermediates and the root) and the `privateJwk` P-256 key of the leaf. The leaf must
carry the agent DID as a URI SAN. The agent never publishes a configured key; the operator
publishes it under `assertionMethod` or `authentication` before startup. Keep the file out of
source control, logs and image layers.

### Development example

```json
{}
```

A file with no key at all runs both capabilities under development signing.

## Administration API

Every method lives under `/v2/openid4vc`, behind the Admin API authentication of the agent, and
answers in the v2 error envelope. Without `OID4VC_CONFIG_FILE_LOCATION`, every path answers `404`.

| Method | Path | Notes |
| --- | --- | --- |
| `createCredentialOffer` | `POST /credential-offer` | `credentialConfigurationId`, `claims`, `ttlSeconds` (60 to 7776000). Returns `credentialExchangeId` and `url`. `404 UNKNOWN_ID`, `400 INVALID_INPUT`. |
| `listCredentialExchanges` | `GET /credential-exchanges` | Filters `credentialConfigurationId`, `state`. Keyset pagination. |
| `getCredentialExchange` | `GET /credential-exchanges/{credentialExchangeId}` | `credentialExchangeId`, `credentialConfigurationId`, `state`, `createdAt`, `updatedAt`, `expiresAt`, `errorMessage`. Never the claims, the offer URL or the pre-authorized code. |
| `deleteCredentialExchange` | `DELETE /credential-exchanges/{credentialExchangeId}` | `204`. Deletes the record only, never a credential that a wallet holds. |
| `createPresentationRequest` | `POST /presentation-request` | `policyId`, optional `queryLanguage` (`dcql`, `presentation_exchange`), optional `requestSigner` (`x5c`, `did`). Returns `proofExchangeId` and `url`. `404 UNKNOWN_ID`, `409 INVALID_STATE`. |
| `listPresentations` | `GET /presentations` | Filters `policyId`, `state`. Keyset pagination. |
| `getPresentation` | `GET /presentations/{proofExchangeId}` | Adds `cryptographicVerified`, `accepted`, `trust` and `credential` once the wallet answered. |
| `deletePresentation` | `DELETE /presentations/{proofExchangeId}` | `204`. |
| `listSigningCertificates` | `GET /signing-certificates` | Bare array of `role`, `development`, `fingerprint`, `certificateChain`. Never a private key. |

Session states are credo's: `OfferCreated`, `OfferUriRetrieved`, `AuthorizationInitiated`,
`AuthorizationGranted`, `AccessTokenRequested`, `AccessTokenCreated`, `CredentialRequestReceived`,
`CredentialsPartiallyIssued`, `Completed`, `Error` for an issuance; `RequestCreated`,
`RequestUriRetrieved`, `ResponseVerified`, `Error` for a verification.

The trust decision of a presentation runs once, when the agent first reads a verified session,
and is stored on the session; a `RESOLVER_UNAVAILABLE` verdict is not stored and is retried on
the next read. A list never decides: it reports the stored decision, and a verified session that
nobody read yet shows `cryptographicVerified: true` and `accepted: false` without `trust`.

## Public endpoints

Served on the public listener, without Admin API authentication. A wallet follows the URLs the
Admin API and the metadata return; it never builds a path itself.

| Path | Purpose |
| --- | --- |
| `/.well-known/openid-credential-issuer`, `/.well-known/oauth-authorization-server`, `/.well-known/jwt-vc-issuer` | Issuer and authorization-server metadata, also at the path-inserted forms. |
| `/oid4vci/issuer/...` | Token and credential traffic of the issuer capability. |
| `/oid4vp/verifier/...` | Authorization request and response traffic of the verifier capability. |
| `/oid4vc/vct/{credentialConfigurationId}` | SD-JWT VC type metadata, extended with `relatedJsonSchemaCredentialId` (the VTJSC). |

## Trust decision

A verifier accepts a presentation only after each step succeeds, in this order:

1. credo verifies the OpenID4VP response, the nonce, the audience, the holder binding, the SD-JWT
   disclosure, the signature, the X.509 chain against the configured roots or an exact
   development fingerprint, and the validity period: a credential without a numeric `exp`, past
   its `exp`, or before its `nbf` fails here, and the session ends in `Error`;
2. the issuer DID is read from a URI SAN of the validated certificate only;
3. the DID is a well-formed `did:web` or `did:webvh` on `allowedDidWebHosts`, with no loopback,
   private or link-local target, and the resolved document id equals the DID;
4. the certificate key matches a verification method the DID Document authorizes under
   `assertionMethod`;
5. the Verana resolver returns `TRUSTED` for the issuer DID and authorizes it for the `vtjscId` of
   the credential configuration;
6. only the verdict `TRUSTED_AUTHORIZED` sets `accepted`.

Any other outcome fails closed: `UNTRUSTED`, `TRUSTED_NOT_AUTHORIZED` or `RESOLVER_UNAVAILABLE`,
with the evidence in `trust.evidence`.

## Wallet accommodations

The public router adapts a few responses to specific wallets, each one scoped as narrowly as the
wallet's behaviour allows: openid4vci-kt (EUDI reference wallet) accept header and
`key_attestations_required`; swiyu plain-JSON metadata and closed `ProofType` enum; wwWallet
`scope` and DPoP algorithms; NL Wallet certificate-bound signed metadata; MOSIP Inji EdDSA
request signing under the parallel did:web and Presentation Exchange details. Each lives next to
the code it changes, with a one-line note.

## Tests

`pnpm --filter @verana-labs/vs-agent-plugin-openid4vc exec vitest run` runs the unit tests and the
in-process end-to-end tests, which start real credo agents for the issuer, the holder and the
verifier and drive a pre-authorized issuance, a DCQL presentation, the four verdicts and response
replay. No external wallet or conformance evidence is recorded here; see the Verana Playground for
recorded wallet scenarios.
