# OpenID4VC follow-up scope

The OpenID4VC foundation PR issues and verifies IETF SD-JWT VC using the `dc+sd-jwt` format. An SD-JWT VC is a verifiable digital credential, but it is not a W3C Verifiable Credentials Data Model credential. Supporting it does not imply support for W3C VCDM JWT credentials, JSON-LD, or Data Integrity proofs.

## Not implemented in this PR

| Area                                        | Follow-up boundary                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W3C VCDM JWT VC                             | Add an explicit W3C VCDM credential configuration, mapping, issuance, verification, and tests. Do not infer this from OpenID4VC transport support.                    |
| W3C Data Integrity and JSON-LD              | Add context handling, canonicalization, proof-suite policy, document loading, and interoperability tests.                                                             |
| ISO mdoc                                    | Add mdoc-specific issuance, device engagement and presentation behavior, certificate policy, and tests.                                                               |
| Status lists                                | Define credential lifetime and suspension or revocation policy, then implement and test the selected status mechanism.                                                |
| Authorization-code issuance                 | Add authorization-server integration, redirect handling, client policy, and end-to-end tests. The foundation creates pre-authorized offers only.                      |
| Wallet attestation trust-list distribution  | Define how attestation roots are obtained, updated, revoked, and audited. The foundation can enforce explicitly configured local roots, but does not distribute them. |
| Production reader and issuer PKI onboarding | Define certificate profiles, issuance ceremonies, root distribution, rotation, revocation, and incident handling for each ecosystem.                                  |
| Formal conformance testing                  | Run the applicable official test suites and external-wallet matrix, retain evidence, and scope every claim to the tested profile and version.                         |

These are separate implementation and assurance tasks. They are not deferred claims of support.

## Authoritative references

- [OpenID for Verifiable Credential Issuance 1.0 Final](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0-final.html)
- [OpenID for Verifiable Presentations 1.0 Final](https://openid.net/specs/openid-4-verifiable-presentations-1_0-final.html)
- [OpenID4VC High Assurance Interoperability Profile 1.0 Final](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-final.html)
- [IETF SD-JWT VC draft 17](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-sd-jwt-vc-17), the draft used by the implementation context
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C Bitstring Status List 1.0](https://www.w3.org/TR/vc-bitstring-status-list/)
- [ISO/IEC 18013-5:2021 overview](https://www.iso.org/standard/69084.html)
