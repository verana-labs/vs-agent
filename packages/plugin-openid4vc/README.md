# OpenID4VC

`@verana-labs/vs-agent-plugin-openid4vc` gives VS Agent an OpenID4VCI issuer and an OpenID4VP
verifier for `dc+sd-jwt` credentials. It ships in every `vs-agent` image and turns on when the
operator sets `OID4VC_CONFIG_FILE_LOCATION`. Nothing else enables it.

What it does:

- pre-authorized OpenID4VCI issuance of `dc+sd-jwt` credentials, revocable through the Token
  Status Lists the agent hosts: an offer that names a `statusListId` and a `statusListIndex` binds
  the index and stamps the `status` claim, `revokeCredential` flips it, and a credential that no
  list registers is valid until the `ttlSeconds` of its offer run out;
- OpenID4VP requests in DCQL (`direct_post.jwt`, `x509_hash` or DID client identifier) or, for a
  wallet that predates DCQL, Presentation Exchange (`direct_post`, `x509_san_dns` or DID client
  identifier, since draft 21 predates `x509_hash`);
- the `/v2/openid4vc` Administration API scope: create an offer or a request, then list, read
  and delete.

Out of scope, and not implied: W3C VCDM credentials, ISO mdoc, authorization-code issuance,
wallet-attestation trust-list distribution, production PKI onboarding, formal conformance.

## Credential types

The configuration file carries no credential type. The agent reads them from the VPR instead: one
per `CredentialSchema` for which it holds an active ISSUER `Participant`, identified by the
`jsonSchemaCredentialId` of that schema. Claims come from the `credentialSubject` properties of
the JSON schema, every one of them selectively disclosable, and the display name from its `title`,
or from the on-chain reference `vpr:verana:{chainId}:cs:{credentialSchemaId}` when it carries none.
The `vct` is the Type Metadata URL of the type, `{ecosystem base}/vt/vct/{credentialSchemaId}`.
A schema the agent cannot resolve is skipped with a warning and the rest of the set still stands.
A `credentialSubject` property named after an SD-JWT VC envelope claim (`vct`, `vct#integrity`,
`iat`, `exp`, `nbf`, `iss`, `cnf`, `status`) is no claim of the type: the issuer stamps those itself,
and an offer that carries one is rejected with `400 INVALID_INPUT`. Neither is `id`: SD-JWT VC binds
the holder through `cnf`, so an `id` the caller supplies would assert a subject the issuer never
checked.

The set follows the VPR without a restart: a `Participant` or `CredentialSchema` notification
rebuilds it and re-renders the served issuer metadata. `createCredentialOffer` validates the
claims against the JSON schema (`400 INVALID_INPUT` with the violations), checks the active
ISSUER `Participant` through the indexer (`409 NOT_AUTHORIZED`, or `503 RESOLVER_UNAVAILABLE`
when the indexer cannot answer), and reads the Type Metadata document over `https`, without
following a redirect, to bind every credential to its `vct#integrity`. It answers
`503 RESOLVER_UNAVAILABLE` when that document cannot be read.

## Revocation

The issuer capability hosts [Token Status Lists](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-status-list),
one bit per status, each served at `{PUBLIC_API_BASE_URL}/oid4vc/status-list/{statusListId}` as
`application/statuslist+jwt`. `createStatusList` signs an all-valid token with the certificate chain
of the issuer capability, the same `x5c` that signs the credentials, so a verifier that applies the
same-chain rule of [[VSA-VTI-FLOW-VERIFY-OID]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-flow-verify-oid-openid4vp-trust-decision)
step 6, credo among them, accepts the list of every credential it accepts. Credo builds and signs
each token through its `tokenStatusList` module; the plugin keeps the lists and the binding of each
index in the agent storage (`OpenId4VcStatusListRecord`, `OpenId4VcStatusListEntryRecord`), so both
survive a restart.

A credential joins a list through its offer: `statusListId` and `statusListIndex`, both or none. The
caller allocates the index. The agent binds it before the offer exists, refuses a later offer that
names it with `409 INVALID_STATE`, stamps `status.status_list` with the `uri` of the list and the
`idx` on every copy the wallet requests, and reports the coordinates on the credential exchange.
`revokeCredential` sets the status at the index to INVALID and publishes the re-signed token before
it answers; a second call changes nothing. The binding outlives the issuance session, so a caller
can revoke a credential whose session it deleted. `deleteStatusList` is refused while an index is
bound to a credential that is not revoked and not expired; an offer that no wallet redeemed binds
its index until the offer expires.

Every token carries `sub` (the `uri`), `iat` and `exp`, 24 hours after `iat`. The agent re-signs a
list on the next read of its URL once half of that lifetime has passed, and whenever the signing
certificate changed since the token was signed. A re-signed list carries the new chain, which ends
the acceptance of every credential the previous certificate signed, as the spec states.

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
| `createCredentialOffer` | `POST /credential-offer` | `jsonSchemaCredentialId`, `claims`, `ttlSeconds` (60 to 7776000, or up to 31536000 for a credential registered on a status list), optional `statusListId` and `statusListIndex` together. Returns `credentialExchangeId` and `url`. `404 UNKNOWN_ID` (type or list), `400 INVALID_INPUT` (claims, `ttlSeconds`, half a pair, index out of range), `409 INVALID_STATE` (index already bound), `409 NOT_AUTHORIZED`, `503 RESOLVER_UNAVAILABLE`. |
| `listCredentialExchanges` | `GET /credential-exchanges` | Filters `jsonSchemaCredentialId`, `state`, `statusListId`. Keyset pagination. |
| `getCredentialExchange` | `GET /credential-exchanges/{credentialExchangeId}` | `credentialExchangeId`, `jsonSchemaCredentialId`, `statusListId` and `statusListIndex` when the offer set them, `state`, `createdAt`, `updatedAt`, `expiresAt`, `errorMessage`. Never the claims, the offer URL or the pre-authorized code. |
| `deleteCredentialExchange` | `DELETE /credential-exchanges/{credentialExchangeId}` | `204`. Deletes the record only, never a credential that a wallet holds. |
| `createPresentationRequest` | `POST /presentation-request` | `jsonSchemaCredentialId`, optional `requestedClaims` (defaults to every claim of the type), optional `queryLanguage` (`dcql`, `presentation_exchange`), optional `requestSigner` (`x5c`, `did`). Returns `proofExchangeId` and `url`. `404 UNKNOWN_ID`, `400 INVALID_INPUT`, `409 NOT_AUTHORIZED`, `503 RESOLVER_UNAVAILABLE`, `409 INVALID_STATE`. The agent has to hold an active VERIFIER `Participant` for the `CredentialSchema` of the type. |
| `listPresentations` | `GET /presentations` | Filters `jsonSchemaCredentialId`, `state`. Keyset pagination. |
| `getPresentation` | `GET /presentations/{proofExchangeId}` | Adds the stored `jsonSchemaCredentialId` and `requestedClaims` of the request, then `cryptographicVerified`, `accepted`, `trust` and `credential` once the wallet answered. |
| `deletePresentation` | `DELETE /presentations/{proofExchangeId}` | `204`. |
| `listSigningCertificates` | `GET /signing-certificates` | Bare array of `role`, `development`, `fingerprint`, `certificateChain`. Never a private key. |
| `listStatusLists` | `GET /status-lists` | Keyset pagination of `statusListId`, `uri`, `size`, `createdAt`, `updatedAt` (the `iat` of the last published token). |
| `createStatusList` | `POST /status-lists` | Optional `size` (1024 to 16777216, default 131072). Publishes the all-valid token before it answers `201` with the record. `400 INVALID_INPUT`. |
| `deleteStatusList` | `DELETE /status-lists/{statusListId}` | `204`; the public URL answers `404` afterwards. `404 UNKNOWN_ID`, `409 INVALID_STATE` while an index is bound to a credential that is not revoked and not expired. |
| `revokeCredential` | `POST /revoke-credential` | `statusListId`, `statusListIndex`. Publishes the re-signed token, then answers `200` with `statusListId`, `statusListIndex`, `revokedAt` (the `iat` of that token). Idempotent. `404 UNKNOWN_ID`, `400 INVALID_INPUT` (index out of range), `409 INVALID_STATE` (no offer bound the index). |

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
| `/oid4vc/status-list/{statusListId}` | The Status List Token of one list, `application/statuslist+jwt`, `Cache-Control: no-store`; `404` for an unknown list. |

## Trust decision

Nothing configures it: no resolver URL, no allowed `did:web` host, no credential-issuer root and no
development fingerprint. The agent decides on the eight steps of [[VSA-VTI-FLOW-VERIFY-OID]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-flow-verify-oid-openid4vp-trust-decision),
on its DID resolver and on the VPR, and fails closed at every one of them.

`createPresentationRequest` resolves the `jsonSchemaCredentialId` to its `CredentialSchema`
through the VTJSC (`404 UNKNOWN_ID` when it binds to none), requires an active VERIFIER
`Participant` of the agent for that schema (`409 NOT_AUTHORIZED`, `503 RESOLVER_UNAVAILABLE`), and
stores the type and the requested claims on the session. The wallet then answers, and credo runs
step 1: the nonce, the audience, the holder binding, the disclosures, the signature, the validity
period (`exp` is required) and the `status` claim, if the credential carries one. For an `x5c`
issuer credo trusts the leaf certificate the wallet presented and nothing above it: step 4 binds
the key through the DID Document, so no certificate authority takes part. A failure of step 1 ends
the session in `Error`, with `cryptographicVerified: false`.

The first `getPresentation` of a `ResponseVerified` session runs the rest and stores the verdict:

| Step | Check | Verdict on failure |
| --- | --- | --- |
| 2 | issuer DID: `iss` when it is a DID, else the URI SAN of the leaf certificate | `UNTRUSTED` |
| 3 | a well-formed `did:web` or `did:webvh`, resolved fresh within 5 seconds, with the requested `id` | `UNTRUSTED` (another method, or a document with another `id`), or `RESOLVER_UNAVAILABLE` when the DID does not resolve |
| 4 | the signing key under `assertionMethod` of that DID Document | `UNTRUSTED` |
| 5 | the Type Metadata at `vct`, read over `https` without a redirect, hashes to `vct#integrity` and names the VTJSC of the request | `UNTRUSTED`, or `RESOLVER_UNAVAILABLE` when the document cannot be read |
| 6 | the `status` claim, verified by credo in step 1 against the issuer chain | the session ends in `Error` |
| 7 | the Verifiable Trust resolution of the issuer DID answers `TRUSTED` within 15 seconds (a positive answer is cached for 5 minutes, as for a DIDComm peer), and the VPR holds an active ISSUER `Participant` of it for the `CredentialSchema` | `UNTRUSTED`, `TRUSTED_NOT_AUTHORIZED`, or `RESOLVER_UNAVAILABLE` when a registry, an endpoint or the indexer does not answer |
| 8 | `accepted` is `true` for `TRUSTED_AUTHORIZED` only | |

`RESOLVER_UNAVAILABLE` is never stored, so the next read retries. `listPresentations` never
decides: it reports the stored verdict, and a verified session nobody read yet shows
`cryptographicVerified: true`, `accepted: false` and no `trust`. The `evidence` of a verdict
carries the issuer `did`, the `trustStatus` of the resolution, the `jsonSchemaCredentialId` and the
`credentialSchemaId` of the request, `authorized`, the `queries` the agent ran and, when the verdict is not
`TRUSTED_AUTHORIZED`, a `note` that names the failed step.

Credo, not the plugin, runs step 6, and the spec asks for two things credo does not do yet: it
fetches the Status List Token with its own client, not under the network boundary of step 3, and it
does not compare the `sub` of the token with the `uri` of the claim.
[credo-ts#3015](https://github.com/openwallet-foundation/credo-ts/pull/3015) adds the option that
lets the plugin take the fetch over; [#754](https://github.com/verana-labs/vs-agent/issues/754)
carries the address ban.

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
verifier, drive a pre-authorized issuance through to a stored holder-bound credential, present
it back to the verifier through to a stored trust verdict, and revoke a registered credential on a
status list the issuer serves until the verifier refuses it. No external wallet or conformance
evidence is recorded here; see the Verana Playground for recorded wallet scenarios.
