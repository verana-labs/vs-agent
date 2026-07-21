# OpenID4VC Foundation Design

**Date:** 2026-07-21
**Issue:** [verana-labs/vs-agent#518](https://github.com/verana-labs/vs-agent/issues/518)
**Status:** Approved for implementation planning

## Context

VS Agent needs an OpenID for Verifiable Credential Issuance (OpenID4VCI) issuer and an OpenID for Verifiable Presentations (OpenID4VP) verifier that can interoperate with European digital identity wallets.

An experimental implementation already exists on `feature/openid4vc-plugin` and `feat/openid4vc-upstream`. It proved issuance against the EUDI reference wallet, but it was built before recent changes on `main`, mixes production and demo responsibilities, and accepts certificate identities without a sufficiently strong binding. Those branches remain useful implementation and interoperability evidence, but the contribution will be rebuilt from current `origin/main`.

The first pull request is deliberately a foundation. It targets SD-JWT VC issuance and presentation over OpenID4VCI/OpenID4VP. It does not claim complete EUDI or HAIP conformance.

## Goals

- Add an optional `@verana-labs/vs-agent-plugin-openid4vc` package.
- Support a configurable OpenID4VCI issuer for `dc+sd-jwt` credentials.
- Support a configurable OpenID4VP verifier using DCQL and HAIP-compatible request signing.
- Keep wallet-facing protocol and metadata endpoints public.
- Keep offer creation, verification request creation, and result access on the authenticated admin API.
- Bind certificate authentication to Verana authorization without trusting an asserted DID on its own.
- Fail closed when certificate validation, identity binding, or Verana trust resolution fails.
- Preserve the interoperability behavior already proven with the EUDI reference wallet where it is secure and standards-aligned.
- Follow the existing VS Agent plugin, configuration, Docker, testing, and release patterns.

## Non-goals

- A production holder wallet inside VS Agent.
- Public wallet credential list, acceptance, or deletion APIs.
- W3C Verifiable Credentials Data Model issuance.
- ISO mdoc issuance or presentation.
- A claim of EUDI certification or full OpenID4VC HAIP conformance.
- An embedded production certificate authority.
- Status-list revocation, authorization-code issuance, or a complete wallet-attestation trust framework in the first pull request.
- Unfold-specific tenants, credential claims, schemas, display strings, or testnet identifiers in the reusable package.

W3C VCDM, mdoc, status management, authorization-code issuance, wallet attestation, and production deployment requirements will be recorded in a follow-up document.

## Standards Baseline

The implementation will use the final OpenID4VCI 1.0, OpenID4VP 1.0, and OpenID4VC HAIP 1.0 specifications as its behavioral baseline. SD-JWT VC behavior will follow the version supported by the pinned Credo dependency while emitting the current `dc+sd-jwt` media type.

Relevant sources:

- <https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0-final.html>
- <https://openid.net/specs/openid-4-verifiable-presentations-1_0-final.html>
- <https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-final.html>
- <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-sd-jwt-vc-17>
- <https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework/releases/tag/v2.9.0>

## Package and Runtime Architecture

The package will expose one plugin factory with independently enabled issuer and verifier capabilities. Enabling neither capability is a configuration error.

The plugin has three integration surfaces:

1. A Credo plugin containing `OpenId4VcModule` and `X509Module` configuration.
2. NestJS providers and admin controllers registered through `VsAgentNestPlugin`.
3. An Express router containing the public OpenID4VC protocol and metadata endpoints created by Credo.

The VS Agent application will load the optional package once, build one plugin instance, pass its Credo modules into agent setup, register its controllers and providers on the admin application, and mount its protocol router on the public application. The same plugin instance must be used for all three surfaces so initialization state and route ownership cannot diverge.

This also avoids the existing experimental pattern of importing and configuring the same optional plugin independently in `setupAgent` and `main`.

### Public protocol surface

The public listener contains only endpoints that wallets need to call without VS Agent admin credentials:

- OpenID4VCI issuer and OAuth metadata.
- Credential and token protocol endpoints supplied by Credo.
- OpenID4VP authorization request and response endpoints supplied by Credo.
- SD-JWT VC type metadata when configured.

The plugin will not add arbitrary issuance, verification orchestration, credential listing, or credential deletion endpoints to the public NestJS module.

### Authenticated control surface

Plugin NestJS controllers are registered with the existing admin module and therefore inherit its current internal or corporation authentication policy. They provide:

- creation of a credential offer from a configured credential type and supplied claims;
- creation of a presentation request from a configured verification policy;
- retrieval of issuance and verification records needed by an operator;
- retrieval of the final verification and Verana trust result.

The controllers will use DTO validation and return explicit client errors for unknown configurations, invalid claims, invalid request state, or unavailable capabilities.

## Configuration Model

The package API will use a typed options object. The VS Agent application will map environment variables to that object in one place and validate it before agent initialization.

Configuration includes:

- public base URL;
- independently enabled issuer and verifier capabilities;
- issuer and verifier identifiers and display metadata;
- one or more SD-JWT VC credential configurations, each with a stable configuration ID, `vct`, display metadata, and allowed claim definitions;
- one or more verifier policies describing the DCQL credential query;
- issuer and verifier signing certificate chains and matching signing keys;
- trusted certificate roots or explicitly pinned development certificates;
- Verana resolver/indexer endpoint, registry identifier, and request timeout.

Secrets are never returned by controllers or written to logs. Configuration errors identify the invalid field without including key material.

No credential type, test tenant, Unfold URL, network, trust registry, or claims are hardcoded in the package.

## Certificate and Trust Model

An OpenID4VC signature proves control of the key in the presented certificate. It does not prove that a DID written into that certificate belongs to the signer. The experimental accept-any-certificate callback therefore cannot be used.

A positive trust decision requires every step below:

1. Credo verifies the protocol signature and proof.
2. The complete `x5c` chain validates against a configured trust root, or the leaf matches an explicitly configured development pin.
3. The identity is extracted from the URI SAN only after certificate validation succeeds.
4. The certificate identity is cryptographically bound to the expected DID or deployment trust policy.
5. The Verana resolver confirms that the authenticated DID is trusted and authorized for the requested schema or presentation purpose.

Missing chains, malformed SANs, unknown roots, mismatched keys, resolver errors, timeouts, negative trust, and negative authorization all reject the operation.

Self-signed certificates are not accepted by default. A self-signed development certificate may only be used when its exact fingerprint is explicitly pinned, and that mode must be documented as non-HAIP and unsuitable for production.

The plugin will not advertise wallet or client attestation support unless a trusted attestation validation policy is configured and enforced. Metadata must describe implemented behavior, not merely behavior needed to satisfy a wallet preflight check.

## Issuance Flow

1. An authenticated operator selects a configured credential type and supplies claims accepted by that configuration.
2. The issuer service validates the request and creates a Credo issuance session.
3. The service signs a `dc+sd-jwt` credential using the configured issuer certificate chain and matching wallet key.
4. The controller returns the credential offer URI and non-secret record metadata.
5. The external wallet resolves metadata, obtains the credential, and performs key binding according to the supported Credo flow.

The first version supports pre-authorized-code issuance because it matches the proven EUDI integration. The offer is a bearer capability and must not be exposed through an unauthenticated convenience endpoint or logged. Authorization-code issuance remains a documented follow-up.

Legacy `vc+sd-jwt` may be accepted where the pinned library requires transitional compatibility, but the issuer emits `dc+sd-jwt`.

## Presentation Flow

1. An authenticated operator selects a configured verifier policy.
2. The verifier service creates a DCQL request signed with the configured verifier certificate and `x509_hash` client identifier scheme.
3. The controller returns the request URI and a verifier record identifier.
4. The external wallet retrieves the request and posts its presentation to the public Credo endpoint.
5. Credo validates the protocol response, SD-JWT VC signature, disclosure, nonce, audience, and holder binding.
6. The plugin validates the credential issuer certificate identity and resolves its Verana trust and authorization.
7. The authenticated result endpoint reports success only when both credential verification and the Verana trust decision succeed.

Cryptographic validity and ecosystem authorization are separate fields in the stored result. Neither may be inferred from the other.

## State and Error Handling

- Initialization is awaited and fails the process when an enabled capability cannot be configured.
- Asynchronous plugin initialization is not started with an unobserved `void` promise.
- Protocol records remain in Credo storage rather than module-global singleton state.
- Any small amount of plugin-owned transient state has a bounded size and expiration derived from the protocol lifetime.
- One-time values are consumed at the protocol-defined point, without preventing a safe retry after a transient transport failure.
- Resolver requests have explicit timeouts and reject on non-success responses, malformed bodies, or ambiguous authorization.
- Error responses do not reveal signing keys, complete credentials, pre-authorized codes, or internal stack traces.

## Testing Strategy

### Automated tests

- configuration validation and disabled-capability behavior;
- issuer metadata and `dc+sd-jwt` offer creation;
- verifier metadata and DCQL request creation;
- successful issuance and presentation between local Credo agents;
- certificate chain validation and exact development pinning;
- spoofed trusted DID in an attacker-controlled SAN;
- certificate/DID key mismatch;
- untrusted and trusted-but-unauthorized identities;
- resolver timeout, malformed response, and unavailability;
- expired, replayed, malformed, or incorrectly bound protocol responses;
- admin authentication coverage for all control endpoints;
- proof that no holder credential-management route is mounted publicly.

### Repository verification

- plugin-focused tests and build;
- affected application tests;
- formatter, ESLint, and TypeScript checks without unrelated rewrites;
- complete workspace build;
- Docker build for the OpenID4VC-enabled VS Agent target;
- complete workspace test comparison.

The untouched `origin/main` baseline on 2026-07-21 builds successfully. Its full test command has six existing failures in `apps/vs-agent/tests/trustService.test.ts` because an external JSON-LD context cannot be dereferenced. Those failures will be reported separately and must not be attributed to this plugin.

### Interoperability verification

Where the required trust material is available, retain secret-safe evidence for:

- successful issuance into the connected Android EUDI reference wallet;
- successful presentation from that wallet to VS Agent;
- rejection of an untrusted issuer or verifier;
- rejection of a trusted but unauthorized identity.

Official EUDI online issuer/verifier tools may supplement the device checks. A failure caused by an external wallet trust store or unavailable online endpoint is recorded as an interoperability finding, not converted into an insecure local bypass.

## Documentation and Follow-ups

The package README will document capabilities, configuration, endpoint ownership, trust assumptions, development mode, and verified interoperability. It will distinguish implementation evidence from certification.

A separate Markdown follow-up will cover:

- W3C VCDM credential formats;
- ISO mdoc;
- status-list revocation and credential lifetime policy;
- authorization-code issuance;
- wallet and client attestation trust lists;
- production reader and issuer PKI onboarding;
- broader EUDI and HAIP conformance testing.

## Delivery

Implementation will remain local until review is complete. Before publication, Maxime will review:

- the final diff;
- automated verification results and known upstream failures;
- retained Android or online-tool evidence;
- the draft pull request title and body.

The eventual pull request will be opened from Maxime's fork against `verana-labs/vs-agent:main` as a draft and will use `Relates to #518` rather than claiming to close the broader issue. Pushing the branch and opening the pull request require Maxime's explicit approval.
