# OpenID4VC

`@verana-labs/vs-agent-plugin-openid4vc` gives VS Agent an OpenID4VCI issuer and an OpenID4VP
verifier for `dc+sd-jwt` credentials. It ships in every `vs-agent` image and turns on when the
operator sets `OID4VC_CONFIG_FILE_LOCATION`. Nothing else enables it.

What it does:

- pre-authorized OpenID4VCI issuance of `dc+sd-jwt` credentials, valid until they expire: the
  agent hosts no status list yet, so a credential carries no `status` claim and the `ttlSeconds`
  of its offer is its only bound;
- OpenID4VP requests in DCQL (`direct_post.jwt`, `x509_hash` or DID client identifier) or, for a
  wallet that predates DCQL, Presentation Exchange (`direct_post`);
- the `/v2/openid4vc` Administration API scope: create an offer or a request, then list, read
  and delete.

Out of scope, and not implied: W3C VCDM credentials, ISO mdoc, authorization-code issuance,
wallet-attestation trust-list distribution, production PKI onboarding, formal conformance.

## Not wired up yet

The configuration file the spec defines carries no credential type and no trust setting, and the
agent derives none of them yet. So `createCredentialOffer` and `createPresentationRequest` answer
`404 UNKNOWN_ID` for every `jsonSchemaCredentialId`, `createCredentialOffer` answers it for every
`statusListId`, and reading a verified presentation answers the `RESOLVER_UNAVAILABLE` verdict.
Four issues carry the rest:

- [#710](https://github.com/verana-labs/vs-agent/issues/710): SD-JWT VC Type Metadata, served at
  the spec path `/vt/vct/{credentialSchemaId}`;
- [#711](https://github.com/verana-labs/vs-agent/issues/711): credential types read from the VPR,
  one per active issuer participant;
- [#712](https://github.com/verana-labs/vs-agent/issues/712): the verifier trust decision on the
  eight steps the spec now defines, with no `trust` block anywhere;
- [#713](https://github.com/verana-labs/vs-agent/issues/713): status lists.

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
location can also be an `https://` URL, which the agent fetches once at startup without following
a redirect. With Helm, put the JSON in `openid4vc.config`.

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
| `issuer.keyAttestationCertificates` | Roots for OpenID4VCI key attestations. When non-empty, the issuer metadata requires a key attestation on every proof. Absent, the `attestation` proof type is neither advertised nor accepted. |
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
| `createCredentialOffer` | `POST /credential-offer` | `jsonSchemaCredentialId`, `claims`, `ttlSeconds` (60 to 7776000), optional `statusListId` and `statusListIndex` together. Returns `credentialExchangeId` and `url`. `404 UNKNOWN_ID`, `400 INVALID_INPUT`. Answers `UNKNOWN_ID` for every credential type until #711 and for every status list until #713. |
| `listCredentialExchanges` | `GET /credential-exchanges` | Filters `jsonSchemaCredentialId`, `state`. Keyset pagination. |
| `getCredentialExchange` | `GET /credential-exchanges/{credentialExchangeId}` | `credentialExchangeId`, `jsonSchemaCredentialId`, `state`, `createdAt`, `updatedAt`, `expiresAt`, `errorMessage`. Never the claims, the offer URL or the pre-authorized code. |
| `deleteCredentialExchange` | `DELETE /credential-exchanges/{credentialExchangeId}` | `204`. Deletes the record only, never a credential that a wallet holds. |
| `createPresentationRequest` | `POST /presentation-request` | `jsonSchemaCredentialId`, optional `requestedClaims` (defaults to every claim of the type), optional `queryLanguage` (`dcql`, `presentation_exchange`), optional `requestSigner` (`x5c`, `did`). Returns `proofExchangeId` and `url`. `404 UNKNOWN_ID`, `400 INVALID_INPUT`, `409 INVALID_STATE`. Answers `UNKNOWN_ID` for every credential type until #711. |
| `listPresentations` | `GET /presentations` | Filters `jsonSchemaCredentialId`, `state`. Keyset pagination. |
| `getPresentation` | `GET /presentations/{proofExchangeId}` | Adds the stored `jsonSchemaCredentialId` and `requestedClaims` of the request, then `cryptographicVerified`, `accepted`, `trust` and `credential` once the wallet answered. |
| `deletePresentation` | `DELETE /presentations/{proofExchangeId}` | `204`. |
| `listSigningCertificates` | `GET /signing-certificates` | Bare array of `role`, `development`, `fingerprint`, `certificateChain`. Never a private key. |

Session states are credo's: `OfferCreated`, `OfferUriRetrieved`, `AuthorizationInitiated`,
`AuthorizationGranted`, `AccessTokenRequested`, `AccessTokenCreated`, `CredentialRequestReceived`,
`CredentialsPartiallyIssued`, `Completed`, `Error` for an issuance; `RequestCreated`,
`RequestUriRetrieved`, `ResponseVerified`, `Error` for a verification.

The agent stores `jsonSchemaCredentialId` and `requestedClaims` on the verification session when
it creates the request, and never infers either from the response of the wallet. A list never
decides: it reports the stored decision, and a verified session that nobody read yet shows
`cryptographicVerified: true` and `accepted: false` without `trust`.

## Public endpoints

Served on the public listener, without Admin API authentication. A wallet follows the URLs the
Admin API and the metadata return; it never builds a path itself.

| Path | Purpose |
| --- | --- |
| `/.well-known/openid-credential-issuer`, `/.well-known/oauth-authorization-server`, `/.well-known/jwt-vc-issuer` | Issuer and authorization-server metadata, also at the path-inserted forms. |
| `/oid4vci/issuer/...` | Token and credential traffic of the issuer capability. |
| `/oid4vp/verifier/...` | Authorization request and response traffic of the verifier capability. |

## Trust decision

There is none yet. Nothing configures a resolver URL, allowed `did:web` hosts, credential-issuer
roots or development fingerprints: the file rejects a `trust` block, and
[#712](https://github.com/verana-labs/vs-agent/issues/712) builds the decision on the eight steps
the spec now defines, on the indexer and on DID key binding, without one. Until it lands, a
verified presentation answers `cryptographicVerified: true`, `accepted: false` and the verdict
`RESOLVER_UNAVAILABLE`, and is never accepted.

What the agent still enforces before that point: credo verifies the OpenID4VP response, the
nonce, the audience, the holder binding, the SD-JWT disclosures and the signature, and the plugin
fails a presented credential that carries no numeric `exp`. The session then ends in `Error`.

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
verifier and drive a pre-authorized issuance through to a stored holder-bound credential. The
presentation round trip comes back with #712, which gives the verifier a trust anchor for the
credential it receives. No external wallet or conformance evidence is recorded here; see the
Verana Playground for recorded wallet scenarios.
