# Indexer v4 Specification

**Latest Draft:** spec v4-draft11

## Abstract

## About this Document

In order to fully understand the concepts developed in this document, you should have some basic knowledge of DID, DIDComm, AnonCreds, the Verifiable Trust model, and the [ToIP stack](https://www.trustoverip.org/toip-model/). All terms used in this specification are defined in the [Terminology](#terminology) section.

## Conformance

As well as sections marked as non-normative, all authoring guidelines, diagrams, examples, and notes in this specification are non-normative. Everything else in this specification is normative.

The key words MAY, MUST, MUST NOT, OPTIONAL, RECOMMENDED, REQUIRED, SHOULD, and SHOULD NOT in this document are to be interpreted as described in [BCP 14](https://datatracker.ietf.org/doc/html/bcp14) [RFC2119](https://w3c.github.io/vc-data-model/#bib-rfc2119) [RFC8174](https://w3c.github.io/vc-data-model/#bib-rfc8174) when, and only when, they appear in all capitals, as shown here.

### Datetime encoding

Every datetime value defined or surfaced by this specification — including but not limited to `atTime`, `evaluatedAtTime`, `expiresAtTime`, `validFrom`, `validUntil`, `lastSlashedAtTime`, `activeSince`, `blockTime`, the TRQP `time` / `time_requested` / `time_evaluated` / `since` / `controlling_since` fields, and any future datetime field added in a backwards-compatible revision — MUST be encoded as an ISO 8601 / RFC 3339 datetime string **in UTC**. Each value MUST include the date, the time (with seconds), and the trailing `Z` UTC designator. Fractional seconds are OPTIONAL. Local times, non-UTC offsets (e.g. `+02:00`), date-only values, and timezone-less times MUST NOT be used. Producers that hold non-UTC times MUST convert them to UTC before serialising. Fields declared nullable (e.g. `expiresAtTime`) MAY instead be JSON `null`; when non-null they MUST conform. The normative regular expression is:

```regex
^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$
```

The JSON Schemas published alongside this document expose this constraint as the reusable `#/$defs/Iso8601DateTime` definition; every datetime property in those schemas references it.

## Terminology

- **AnonCreds** — Anonymous Credentials, a privacy-preserving verifiable credential format supporting selective disclosure and unlinkability.
- **decentralized identifier (DID, DIDs)** — A decentralized identifier, as specified in [DID-CORE](https://www.w3.org/TR/did-core/).
- **DIDComm** — A peer-to-peer messaging protocol built on DIDs, as specified by the [DIDComm Messaging Specification](https://identity.foundation/didcomm-messaging/spec/).
- **Verifiable Public Registry (VPR, VPRs)** — A decentralized registry used to publish and resolve trust-related resources (Credential Schemas, Ecosystems, Governance Frameworks, etc.), as specified by the [Verifiable Trust VPR specification](https://github.com/verana-labs/verifiable-trust-vpr-spec).
- **Verifiable Service (Verifiable Services)** — A service that identifies its operator, purpose, and governance context through verifiable credentials, as defined in the [Verifiable Trust specification](https://github.com/verana-labs/verifiable-trust-spec).
- **Verifiable Trust** — The open, decentralized trust layer specified at [verana-labs/verifiable-trust-spec](https://github.com/verana-labs/verifiable-trust-spec).
- **VS Agent** — The runtime component specified by this document, which hosts a Verifiable Service and exposes a REST API and event model to backend implementations.
- **VTJSC, Verifiable Trust JSON Schema Credential** — A W3C `JsonSchemaCredential` issued by an Ecosystem DID that references a `CredentialSchema` entry in a Verifiable Public Registry, cryptographically binding that schema to the Ecosystem in which it is defined. Specified in [VT-JSON-SCHEMA-CRED-W3C](https://github.com/verana-labs/verifiable-trust-spec/blob/main/spec.md#vt-json-schema-cred-w3c-verifiable-trust-json-schema-credential) of the Verifiable Trust Specification.
- **W3C Verifiable Credentials Data Model (W3C VC Data Model)** — The W3C Recommendation defining a standard data model for verifiable credentials, as specified in [W3C Verifiable Credentials Data Model v2.0](https://www.w3.org/TR/vc-data-model/).

## API

### Method List

| Module | Method Name | Relative API path | Type | Requirements | Authz |
| --- | --- | --- | --- | --- | --- |
| Corporation | Get Corporation | `/v4/corporation/get/{id}` | Query | [`IDX-CO-QRY-1`](#idx-co-qry-1-get-corporation) | PUBLIC |
| Corporation | List Corporations | `/v4/corporation/list` | Query | [`IDX-CO-QRY-2`](#idx-co-qry-2-list-corporations) | PUBLIC |
| Corporation | Get Corporation Params | `/v4/corporation/params` | Query | [`IDX-CO-QRY-3`](#idx-co-qry-3-get-corporation-params) | PUBLIC |
| Corporation | Get Corporation History | `/v4/corporation/history/{id}` | Query | [`IDX-CO-QRY-4`](#idx-co-qry-4-get-corporation-history) | PUBLIC |
| Ecosystem | Get Ecosystem | `/v4/ecosystem/get/{id}` | Query | [`IDX-ES-QRY-1`](#idx-es-qry-1-get-ecosystem) | PUBLIC |
| Ecosystem | List Ecosystems | `/v4/ecosystem/list` | Query | [`IDX-ES-QRY-2`](#idx-es-qry-2-list-ecosystems) | PUBLIC |
| Ecosystem | Get Ecosystem Params | `/v4/ecosystem/params` | Query | [`IDX-ES-QRY-3`](#idx-es-qry-3-get-ecosystem-params) | PUBLIC |
| Ecosystem | Get Ecosystem History | `/v4/ecosystem/history/{id}` | Query | [`IDX-ES-QRY-4`](#idx-es-qry-4-get-ecosystem-history) | PUBLIC |
| Governance Framework | Get Governance Framework Version | `/v4/governance-framework/get/{id}` | Query | [`IDX-GF-QRY-1`](#idx-gf-qry-1-get-governance-framework-version) | PUBLIC |
| Governance Framework | List Governance Framework Versions | `/v4/governance-framework/list` | Query | [`IDX-GF-QRY-2`](#idx-gf-qry-2-list-governance-framework-versions) | PUBLIC |
| Credential Schema | Get Credential Schema | `/v4/credential-schema/get/{id}` | Query | [`IDX-CS-QRY-1`](#idx-cs-qry-1-get-credential-schema) | PUBLIC |
| Credential Schema | List Credential Schemas | `/v4/credential-schema/list` | Query | [`IDX-CS-QRY-2`](#idx-cs-qry-2-list-credential-schemas) | PUBLIC |
| Credential Schema | Get JSON Schema | `/v4/credential-schema/js/{id}` | Query | [`IDX-CS-QRY-3`](#idx-cs-qry-3-get-json-schema) | PUBLIC |
| Credential Schema | Get Credential Schema Params | `/v4/credential-schema/params` | Query | [`IDX-CS-QRY-4`](#idx-cs-qry-4-get-credential-schema-params) | PUBLIC |
| Credential Schema | Get Credential Schema History | `/v4/credential-schema/history/{id}` | Query | [`IDX-CS-QRY-5`](#idx-cs-qry-5-get-credential-schema-history) | PUBLIC |
| Participant | Get Participant | `/v4/participant/get/{id}` | Query | [`IDX-PP-QRY-1`](#idx-pp-qry-1-get-participant) | PUBLIC |
| Participant | List Participants | `/v4/participant/list` | Query | [`IDX-PP-QRY-2`](#idx-pp-qry-2-list-participants) | PUBLIC |
| Participant | Get Participant History | `/v4/participant/history/{id}` | Query | [`IDX-PP-QRY-3`](#idx-pp-qry-3-get-participant-history) | PUBLIC |
| Participant | Find Beneficiaries | `/v4/participant/beneficiaries` | Query | [`IDX-PP-QRY-4`](#idx-pp-qry-4-find-beneficiaries) | PUBLIC |
| Participant | Pending Flat | `/v4/participant/pending/flat` | Query | [`IDX-PP-QRY-5`](#idx-pp-qry-5-pending-flat) | PUBLIC |
| Participant | Get Participant Session | `/v4/participant/participant-session/{id}` | Query | [`IDX-PP-QRY-6`](#idx-pp-qry-6-get-participant-session) | PUBLIC |
| Participant | Get Participant Session History | `/v4/participant/participant-session-history/{id}` | Query | [`IDX-PP-QRY-7`](#idx-pp-qry-7-get-participant-session-history) | PUBLIC |
| Participant | Get Participant Params | `/v4/participant/params` | Query | [`IDX-PP-QRY-8`](#idx-pp-qry-8-get-participant-params) | PUBLIC |
| Trust Deposit | Get Trust Deposit By Corporation | `/v4/trust-deposit/get/{corporation_id}` | Query | [`IDX-TD-QRY-1`](#idx-td-qry-1-get-trust-deposit-by-corporation) | PUBLIC |
| Trust Deposit | Get Trust Deposit Params | `/v4/trust-deposit/params` | Query | [`IDX-TD-QRY-2`](#idx-td-qry-2-get-trust-deposit-params) | PUBLIC |
| Trust Deposit | Get Trust Deposit History | `/v4/trust-deposit/history/{corporation_id}` | Query | [`IDX-TD-QRY-3`](#idx-td-qry-3-get-trust-deposit-history) | PUBLIC |
| Delegation | List Operator Authorizations | `/v4/delegation/operator-authorizations` | Query | [`IDX-DE-QRY-1`](#idx-de-qry-1-list-operator-authorizations) | PUBLIC |
| Delegation | List VS Operator Authorizations | `/v4/delegation/vs-operator-authorizations` | Query | [`IDX-DE-QRY-2`](#idx-de-qry-2-list-vs-operator-authorizations) | PUBLIC |
| Delegation | Get Operator Authorization | `/v4/delegation/operator-authorization/{id}` | Query | [`IDX-DE-QRY-3`](#idx-de-qry-3-get-operator-authorization) | PUBLIC |
| Delegation | Get VS Operator Authorization | `/v4/delegation/vs-operator-authorization/{id}` | Query | [`IDX-DE-QRY-4`](#idx-de-qry-4-get-vs-operator-authorization) | PUBLIC |
| Delegation | List Fee Grants | `/v4/delegation/fee-grants` | Query | [`IDX-DE-QRY-5`](#idx-de-qry-5-list-fee-grants) | PUBLIC |
| Digest | Get Digest | `/v4/di/get/{digest}` | Query | [`IDX-DI-QRY-1`](#idx-di-qry-1-get-digest) | PUBLIC |
| Group | Get Corporation Group | `/v4/group/get/{corporation_id}` | Query | [`IDX-GR-QRY-1`](#idx-gr-qry-1-get-corporation-group) | PUBLIC |
| Group | List Corporations By Member | `/v4/group/corporations-by-member` | Query | [`IDX-GR-QRY-2`](#idx-gr-qry-2-list-corporations-by-member) | PUBLIC |
| Group | List Proposals | `/v4/group/proposals` | Query | [`IDX-GR-QRY-3`](#idx-gr-qry-3-list-proposals) | PUBLIC |
| Group | Get Proposal | `/v4/group/proposal/{id}` | Query | [`IDX-GR-QRY-4`](#idx-gr-qry-4-get-proposal) | PUBLIC |
| Group | List Votes | `/v4/group/votes` | Query | [`IDX-GR-QRY-5`](#idx-gr-qry-5-list-votes) | PUBLIC |
| Exchange Rate | Get Exchange Rate | `/v4/exchange-rate/get` | Query | [`IDX-XR-QRY-1`](#idx-xr-qry-1-get-exchange-rate) | PUBLIC |
| Exchange Rate | List Exchange Rates | `/v4/exchange-rate/list` | Query | [`IDX-XR-QRY-2`](#idx-xr-qry-2-list-exchange-rates) | PUBLIC |
| Exchange Rate | Get Price | `/v4/exchange-rate/price` | Query | [`IDX-XR-QRY-3`](#idx-xr-qry-3-get-price) | PUBLIC |
| Metrics | Get Global Metrics | `/v4/metrics/all` | Query | [`IDX-METRICS-QRY-1`](#idx-metrics-qry-1-get-global-metrics) | PUBLIC |
| Statistics | Get Stats | `/v4/stats/get` | Query | [`IDX-STATS-QRY-1`](#idx-stats-qry-1-get-stats) | PUBLIC |
| Statistics | Get Stats Range | `/v4/stats/stats` | Query | [`IDX-STATS-QRY-2`](#idx-stats-qry-2-get-stats-range) | PUBLIC |
| Statistics | Count Participants | `/v4/stats/count-participants` | Query | [`IDX-STATS-QRY-3`](#idx-stats-qry-3-count-participants) | PUBLIC |
| Indexer | Get Block Height | `/v4/indexer/block-height` | Query | [`IDX-INDEXER-QRY-1`](#idx-indexer-qry-1-get-block-height) | PUBLIC |
| Indexer | Get Indexer Status | `/v4/indexer/status` | Query | [`IDX-INDEXER-QRY-2`](#idx-indexer-qry-2-get-indexer-status) | PUBLIC |
| Indexer | Get Version | `/v4/indexer/version` | Query | [`IDX-INDEXER-QRY-3`](#idx-indexer-qry-3-get-version) | PUBLIC |
| Indexer | Get Indexer Snapshot | `/v4/indexer/snapshot` | Query | [`IDX-INDEXER-QRY-4`](#idx-indexer-qry-4-get-indexer-snapshot) | PUBLIC |
| Indexer | List Changes | `/v4/indexer/changes` | Query | [`IDX-INDEXER-QRY-5`](#idx-indexer-qry-5-list-changes) | PUBLIC |
| Indexer | List Indexer Events | `/v4/indexer/events` | Query | [`IDX-INDEXER-QRY-6`](#idx-indexer-qry-6-list-indexer-events) | PUBLIC |
| Indexer | Subscribe Indexer Events | `/v4/indexer/subscribe` | Subscription (WebSocket) | [`IDX-INDEXER-SUB-1`](#idx-indexer-sub-1-subscribe-indexer-events) | PUBLIC |
| Verifiable Trust Resolver | Resolve | `/v4/verifiable-trust/resolve` | Query | [`IDX-VT-QRY-1`](#idx-vt-qry-1-resolve), [[VS-REQ-2]], [[VS-REQ-3]], [[VS-REQ-4]] | PUBLIC |
| Verifiable Trust Resolver | Subscribe Changes | `/v4/verifiable-trust/subscribe` | Subscription (WebSocket) | [`IDX-VT-SUB-1`](#idx-vt-sub-1-subscribe-changes) | PUBLIC |
| Verifiable Trust Resolver | List Changes | `/v4/verifiable-trust/changes` | Query | [`IDX-VT-QRY-2`](#idx-vt-qry-2-list-changes) | PUBLIC |
| Verifiable Trust Resolver | List Indexed DIDs | `/v4/verifiable-trust/dids` | Query | [`IDX-VT-QRY-3`](#idx-vt-qry-3-list-indexed-dids) | PUBLIC |
| TRQP | TRQP Authorize | `/v4/trqp/v2/authorization` | Query | [`IDX-TRQP-QRY-1`](#idx-trqp-qry-1-trqp-authorize) | PUBLIC |
| TRQP | TRQP Recognize | `/v4/trqp/v2/recognition` | Query | [`IDX-TRQP-QRY-2`](#idx-trqp-qry-2-trqp-recognize) | PUBLIC |

All methods are specified in [Method Specification](#method-specification) below, grouped by module.

### Method Specification

This section specifies the raw indexer methods that expose VPR ledger entities (Corporations, Ecosystems, Governance Framework versions, Credential Schemas, Participants, Trust Deposits, Operator Authorizations, Digests, Exchange Rates), the Cosmos SDK `x/group` state anchoring Corporations (groups, members, policies, proposals, votes), and the aggregate / statistical / operational state derived from them. They are pure query views; none mutate state. Per-method request and response JSON Schemas are published alongside this document at [`schemas/v4/idx/`](./schemas/v4/idx/) *(schemas to be added in a follow-up commit)*.

#### Conventions

These conventions apply throughout this section unless overridden by a specific method.

##### `At-Block-Height` header

Every method accepts an optional `At-Block-Height` HTTP request header (integer block height). When provided, the method returns the indexer's view of the requested entity **as it was when the specified block finished processing**. When omitted, the latest indexed state is returned. The header MUST be a positive integer not exceeding the indexer's current `lastProcessedBlock`; otherwise the response is HTTP 400.

Responses for non-list methods echo the resolved block in a `block_height` response field so clients that omitted the header can still pin subsequent calls to the same point-in-time.

##### `trust_data` query parameter

A subset of methods (`getEcosystem`, `listEcosystems`, `getParticipant`, `listParticipants`, `pendingFlat`) accept an optional `trust_data` query parameter that enriches each DID-bearing object inline with the resolver's trust evaluation. Values:

- `null` (default) — no enrichment; the `trust_data` field is omitted from each object.
- `summary` — adds a [vt response object](schemas/v4/vt/response.schema.json) to the response with `trusted`, `evaluatedAtTime`, `evaluatedAtBlock`, `expiresAtTime`,  `corporationId`.
- `full` — adds a [vt response object](schemas/v4/vt/response.schema.json) to the response with the same data than `summary`, plus object `ecsCredentials`.

For higher-level trust evaluation use [`resolve`](#verifiable-trust-resolver-methods) instead.

> Note: if a ECS-Service credential is not self-issued by the DID that is presenting it, it is required to resolve its issuer DID to obtain the ECS-organization or ECS-Persona and properly identify service controller.

##### Pagination

Every list and history method paginates **in `id` order**. The cursor is a half-open range on the entity's `id`, and the sort is `±id`. Cross-column sorting on aggregates or timestamps (`modified`, `weight`, `issued`, etc.) is intentionally not supported: those values are not unique within a block and cannot serve as stable cursors. The `id` is unique and monotonic by construction, so pagination is stable across same-block writes.

Universal parameters:

- `limit` (integer; 1..1024, default 64) — caps the number of items returned.
- `min_id` (uint64; inclusive) and `max_id` (uint64; exclusive) — half-open range cursor on the entity's `id`. For history methods the cursor key is `ActivityItem.id` (an indexer-assigned per-row monotonic uint64, distinct from `entity_id`).

Stable cursor recipe: read the first page with `limit=N` (the implicit default `sort=-id` applies, giving newest-first); on the next call, pass `max_id=<id of the last item on the previous page>` to continue. For ascending (oldest-first) order, set `sort=+id` and use `min_id=<id of the last item>` instead.

##### `sort` query parameter

List and history methods accept a `sort` query parameter whose value is `id` (with an optional `+` prefix) or `-id`. The default is `-id` (descending, newest-first). No other sort columns are supported — see [Pagination](#pagination) for the rationale.

##### Standard List Filters

The list methods on Ecosystem, Credential Schema, and Participant accept a common set of bounded range filters (lower bound inclusive, upper bound exclusive). They are omitted from individual method tables below to keep them compact.

| Filter pair | Meaning |
| --- | --- |
| `min_participants` / `max_participants` | Total active participants |
| `min_participants_ecosystem` / `max_participants_ecosystem` | Active `ECOSYSTEM`-role participants |
| `min_participants_issuer_grantor` / `max_participants_issuer_grantor` | Active `ISSUER_GRANTOR`-role participants |
| `min_participants_issuer` / `max_participants_issuer` | Active `ISSUER`-role participants |
| `min_participants_verifier_grantor` / `max_participants_verifier_grantor` | Active `VERIFIER_GRANTOR`-role participants |
| `min_participants_verifier` / `max_participants_verifier` | Active `VERIFIER`-role participants |
| `min_participants_holder` / `max_participants_holder` | Active `HOLDER`-role participants |
| `min_weight` / `max_weight` | Sum of Participant trust-deposit weights (int64) |
| `min_issued` / `max_issued` | Total issued credentials (int64) |
| `min_verified` / `max_verified` | Total verified credentials (int64) |
| `min_ecosystem_slash_events` / `max_ecosystem_slash_events` | Ecosystem-governance slash event count |
| `min_network_slash_events` / `max_network_slash_events` | Network-governance slash event count |

In addition, `listEcosystems` accepts `min_active_schemas` / `max_active_schemas`.

##### Participant State Semantics

`Participant` entries carry several timestamp fields on-chain (`slashed`, `revoked`, `repaid`, `effective_from`, `effective_until`, `modified`) but **no** explicit lifecycle-state field. The indexer derives a single `participant_state` enum at evaluation time from those timestamps and exposes it as both a response field on `getParticipant` / `listParticipants` and a query filter on `listParticipants`. The derivation rules, evaluated in this priority order at the resolved point-in-time `now` (the current block, or the `At-Block-Height` block if set), are:

| Priority | State | Condition |
| --- | --- | --- |
| 1 | `REPAID` | `slashed` is non-null AND `repaid` is non-null AND `repaid >= slashed` |
| 2 | `SLASHED` | `slashed` is non-null AND (`repaid` is null OR `repaid < slashed`) |
| 3 | `REVOKED` | `revoked` is non-null AND `revoked <= now` |
| 4 | `EXPIRED` | `effective_until` is non-null AND `effective_until <= now` |
| 5 | `FUTURE` | `effective_from` is non-null AND `effective_from > now` |
| 6 | `ACTIVE` | `effective_from` is null OR `effective_from <= now`, AND (`effective_until` is null OR `effective_until > now`), AND no higher-priority state applies |
| 7 | `INACTIVE` | none of the above (e.g. onboarding-process in `PENDING` or `TERMINATED` with no `effective_from` yet set) |

`participant_state` is purely indexer-computed. It is not part of the VPR `Participant` data model and must not be confused with `op_state` (the on-chain `PENDING` / `VALIDATED` / `TERMINATED` enum that tracks the onboarding process, not the overall Participant lifecycle).

##### Available Actions Semantics

The indexer derives two arrays of next-step VPR messages for every `Participant` entry it returns:

- **`corporation_available_actions[]`** — VPR messages the **owning Corporation** (`corporation_id`) MAY execute against this entry. A subset of `RenewParticipantOP`, `CancelParticipantOPLastRequest`, `RevokeParticipant`, `SetParticipantEffectiveUntil`, `RepayParticipantSlashedTrustDeposit`.
- **`validator_available_actions[]`** — VPR messages the **validator Corporation** (the Corporation that owns `validator_participant`, i.e. the Participant referenced by `validator_participant_id`) MAY execute against this entry. A subset of `SetParticipantOPtoValidated`, `SetParticipantEffectiveUntil`, `RevokeParticipant`, `SlashParticipantTrustDeposit`.

Both arrays are recomputed at the resolved evaluation block (current block, or the `At-Block-Height` block if set). They are UI-affordance hints only — the on-chain `MOD-PP-MSG-*` handlers remain the authoritative source for which messages are accepted; the indexer mirrors that policy for display purposes.

Eligibility is evaluated per (`role`, schema `issuer_onboarding_mode`, schema `verifier_onboarding_mode`, `participant_state`, `op_state`) tuple against the rules below. **Every action cell defaults to "no" and is flipped to "yes" if at least one matching row produces a "yes" for that action.** For Participants created via [[MOD-PP-MSG-7 Create Root Participant]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-7-create-root-participant) or [[MOD-PP-MSG-14 Self Create Participant]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-14-self-create-participant) — i.e. `validator_participant_id` is null — `op_state` is `VALIDATED` from creation and never participates in a `PENDING` / `TERMINATED` loop. Rows below marked `op_state = —` apply to those self-managed Participants only.

###### Corporation-owner action table

| `role` | `issuer_onboarding_mode` | `verifier_onboarding_mode` | `participant_state` | `op_state` | `RenewParticipantOP` | `CancelParticipantOPLastRequest` | `RevokeParticipant` | `SetParticipantEffectiveUntil` | `RepayParticipantSlashedTrustDeposit` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `REPAID` | any ||||||
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `SLASHED` | any ||||| yes |
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `REVOKED` | any ||||||
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `ACTIVE`, `FUTURE`, `INACTIVE` | `VALIDATED` | yes — iff `validator_participant.participant_state` is `ACTIVE` || yes — iff `participant_state` is `ACTIVE` or `FUTURE` |||
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `ACTIVE`, `FUTURE`, `INACTIVE` | `PENDING` || yes | yes — iff `participant_state` is `ACTIVE` or `FUTURE` |||
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | any | `TERMINATED` ||||||
| `ISSUER` | `OPEN` | any | `REPAID`, `REVOKED` | — ||||||
| `ISSUER` | `OPEN` | any | `SLASHED` | — ||||| yes |
| `ISSUER` | `OPEN` | any | `ACTIVE`, `FUTURE`, `INACTIVE` | — ||| yes | yes ||
| `HOLDER` | any | any | `REPAID` | any ||||||
| `HOLDER` | any | any | `SLASHED` | any ||||| yes |
| `HOLDER` | any | any | `REVOKED` | any ||||||
| `HOLDER` | any | any | `ACTIVE`, `FUTURE`, `INACTIVE` | `VALIDATED` | yes — iff `validator_participant.participant_state` is `ACTIVE` || yes — iff `participant_state` is `ACTIVE` or `FUTURE` |||
| `HOLDER` | any | any | `ACTIVE`, `FUTURE`, `INACTIVE` | `PENDING` || yes | yes — iff `participant_state` is `ACTIVE` or `FUTURE` |||
| `HOLDER` | any | any | any | `TERMINATED` ||||||
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `REPAID` | any ||||||
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `SLASHED` | any ||||| yes |
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `REVOKED` | any ||||||
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `ACTIVE`, `FUTURE`, `INACTIVE` | `VALIDATED` | yes — iff `validator_participant.participant_state` is `ACTIVE` || yes — iff `participant_state` is `ACTIVE` or `FUTURE` |||
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `ACTIVE`, `FUTURE`, `INACTIVE` | `PENDING` || yes | yes — iff `participant_state` is `ACTIVE` or `FUTURE` |||
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `TERMINATED` ||||||
| `VERIFIER` | any | `OPEN` | `REPAID`, `REVOKED` | — ||||||
| `VERIFIER` | any | `OPEN` | `SLASHED` | — ||||| yes |
| `VERIFIER` | any | `OPEN` | `ACTIVE`, `FUTURE`, `INACTIVE` | — ||| yes | yes ||
| `ECOSYSTEM` | any | any | `REPAID`, `REVOKED` | — ||||||
| `ECOSYSTEM` | any | any | `SLASHED` | — ||||| yes |
| `ECOSYSTEM` | any | any | `ACTIVE`, `FUTURE`, `INACTIVE` | — ||| yes | yes ||

###### Validator action table

In the `SetParticipantEffectiveUntil` column, "new `effective_until`" refers to the value proposed in the message; the cell is "yes" only when that proposed value is less than or equal to the entry's current `op_exp`.

| `role` | `issuer_onboarding_mode` | `verifier_onboarding_mode` | `participant_state` | `op_state` | `SetParticipantOPtoValidated` | `SetParticipantEffectiveUntil` | `RevokeParticipant` | `SlashParticipantTrustDeposit` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | any | any |||| yes |
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `ACTIVE`, `FUTURE` | any ||| yes | yes |
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `ACTIVE`, `FUTURE` | `VALIDATED` || yes — iff new `effective_until` ≤ `op_exp` | yes | yes |
| `ISSUER_GRANTOR`, `ISSUER` | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | `ACTIVE`, `FUTURE`, `INACTIVE` | `PENDING` | yes ||||
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | any | any |||| yes |
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `ACTIVE`, `FUTURE` | any ||| yes | yes |
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `ACTIVE`, `FUTURE` | `VALIDATED` || yes — iff new `effective_until` ≤ `op_exp` | yes | yes |
| `VERIFIER_GRANTOR`, `VERIFIER` | any | `GRANTOR_ONBOARDING_PROCESS`, `ECOSYSTEM_ONBOARDING_PROCESS` | `ACTIVE`, `FUTURE`, `INACTIVE` | `PENDING` | yes ||||
| `HOLDER` | any | any | any | any |||| yes |
| `HOLDER` | any | any | `ACTIVE`, `FUTURE` | any ||| yes | yes |
| `HOLDER` | any | any | `ACTIVE`, `FUTURE` | `VALIDATED` || yes — iff new `effective_until` ≤ `op_exp` | yes | yes |
| `HOLDER` | any | any | `ACTIVE`, `FUTURE`, `INACTIVE` | `PENDING` | yes ||||

Both `*_available_actions[]` arrays are purely indexer-computed. They are not part of the VPR `Participant` data model.

##### Active Participant Count Semantics

`Participant`-count aggregates surface on every queryable entity that has a related Participant tree:

- **Global Current Metrics** ([`IDX-METRICS-QRY-1`](#idx-metrics-qry-1-get-global-metrics)) — network-wide totals.
- **Ecosystem** ([`IDX-ES-QRY-1`](#idx-es-qry-1-get-ecosystem)) — totals for every `CredentialSchema` owned by the Ecosystem and the Participant tree under each.
- **CredentialSchema** ([`IDX-CS-QRY-1`](#idx-cs-qry-1-get-credential-schema)) — totals for the schema's Participant tree.
- **Participant** ([`IDX-PP-QRY-1`](#idx-pp-qry-1-get-participant)) — totals for the sub-tree of `Participant` entries having this `Participant.id` somewhere in their `validator_participant_id` ancestry.

On every such entity the indexer exposes the same seven-field breakdown, resolved at the evaluation block (latest, or `At-Block-Height`):

- `participants` — total `Participant` entries with `participant_state` = `ACTIVE`.
- `participants_ecosystem` — `ACTIVE` and `role` = `ECOSYSTEM`.
- `participants_issuer_grantor` — `ACTIVE` and `role` = `ISSUER_GRANTOR`.
- `participants_issuer` — `ACTIVE` and `role` = `ISSUER`.
- `participants_verifier_grantor` — `ACTIVE` and `role` = `VERIFIER_GRANTOR`.
- `participants_verifier` — `ACTIVE` and `role` = `VERIFIER`.
- `participants_holder` — `ACTIVE` and `role` = `HOLDER`.

The same counts are queryable historically by block-height via [`IDX-STATS-QRY-3 Count Participants`](#idx-stats-qry-3-count-participants).

###### The recomputation problem

`participant_state` is a function of on-chain timestamps **and** wall-clock at the evaluation block (see [Participant State Semantics](#participant-state-semantics)). Entries can therefore transition `FUTURE` → `ACTIVE` or `ACTIVE` → `EXPIRED` without any transaction simply because `effective_from` / `effective_until` crossed `now`. For a Participant tree with hundreds of thousands of entries, recomputing every state at read time is prohibitive.

The indexer therefore maintains an **append-only counter log** keyed by (`entity_kind`, `entity_id`, `role_type`, `height`), populated by two complementary triggers:

- **Transaction-driven** — a VPR message executed at block `H` mutates one or more on-chain `Participant` timestamps.
- **Time-driven** — at every block `H` the indexer materialises any `Participant`-state transition whose timestamp falls in the interval `(H-1.block_time, H.block_time]`.

###### Indexer-internal data model

```sql
-- role: 1=ECOSYSTEM, 2=ISSUER_GRANTOR, 3=ISSUER, 4=VERIFIER_GRANTOR, 5=VERIFIER, 6=HOLDER
create table participants (
  id                       bigint primary key,

  -- immutable placement
  schema_id                bigint   not null references credential_schemas(id),
  validator_participant_id bigint   null     references participants(id),
  role                     smallint not null check (role in (1,2,3,4,5,6)),

  -- mutable state inputs (mirrored from VPR `Participant`)
  effective_from           timestamptz null,
  effective_until          timestamptz null,
  revoked                  timestamptz null,
  slashed                  timestamptz null,
  repaid                   timestamptz null,

  -- counter machinery
  last_valid_flip_version  smallint    not null default 0,
  modified_at_height       bigint      not null,
  modified_at_time         timestamptz not null
);

-- flip_kind: 1=ENTER_ACTIVE, 2=EXIT_ACTIVE
-- status:    0=PENDING, 1=APPLIED, 2=STALE
create table participant_scheduled_flips (
  participant_id  bigint      not null references participants(id),
  flip_at_time    timestamptz not null,
  flip_kind       smallint    not null check (flip_kind in (1,2)),
  status          smallint    not null default 0 check (status in (0,1,2)),
  version         smallint    not null,
  applied_height  bigint      null,
  applied_time    timestamptz null,
  created_at      timestamptz not null default now(),
  primary key (participant_id, version, flip_at_time, flip_kind)
);

create index psf_pending_idx
  on participant_scheduled_flips(flip_at_time, participant_id)
  where status = 0;

-- entity_kind: 0=GLOBAL, 1=ECOSYSTEM, 2=CREDENTIAL_SCHEMA, 3=PARTICIPANT
-- role_type:   0=ANY, 1=ECOSYSTEM, 2=ISSUER_GRANTOR, 3=ISSUER, 4=VERIFIER_GRANTOR, 5=VERIFIER, 6=HOLDER
create table entity_participant_changes (
  height        bigint      not null,
  block_time    timestamptz not null,
  entity_kind   smallint    not null check (entity_kind in (0,1,2,3)),
  entity_id     bigint      null,
  role_type     smallint    not null check (role_type in (0,1,2,3,4,5,6)),
  value         bigint      not null,
  primary key (entity_kind, entity_id, role_type, height)
);

create index epc_lookup_idx
  on entity_participant_changes(entity_kind, entity_id, role_type, height desc);
```

`participants.last_valid_flip_version` is a per-`Participant` monotonic counter. Every state-affecting transaction bumps it, **invalidating in bulk** any earlier `participant_scheduled_flips` rows still in `PENDING` — so the indexer never has to delete or rewrite past rows when a `Participant`'s schedule changes.

###### Per-message logic (state-affecting messages only)

The indexer maintains the schedule only for VPR messages that can change `participant_state`:

- [`SetParticipantOPtoValidated`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-3-set-participant-op-to-validated) (MOD-PP-MSG-3)
- [`CreateRootParticipant`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-7-create-root-participant) (MOD-PP-MSG-7)
- [`SetParticipantEffectiveUntil`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-8-set-participant-effective-until) (MOD-PP-MSG-8)
- [`RevokeParticipant`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-9-revoke-participant) (MOD-PP-MSG-9)
- [`SlashParticipantTrustDeposit`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-12-slash-participant-trust-deposit) (MOD-PP-MSG-12)
- [`RepayParticipantSlashedTrustDeposit`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-13-repay-participant-slashed-trust-deposit) (MOD-PP-MSG-13)
- [`SelfCreateParticipant`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-14-self-create-participant) (MOD-PP-MSG-14)

Messages that only touch the onboarding-process pre-state ([`StartParticipantOP`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-1-start-participant-op), [`RenewParticipantOP`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-2-renew-participant-op), [`CancelParticipantOPLastRequest`](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-6-cancel-participant-op-last-request)) cannot alter `participant_state` and skip steps 2–4 below.

For every state-affecting message executed at block `H` with timestamp `H.block_time`:

1. **Persist the `Participant` mutation** — write the new on-chain field values to the `participants` row; set `modified_at_height = H`, `modified_at_time = H.block_time`.
2. **Recompute the new `participant_state`** using the rules from [Participant State Semantics](#participant-state-semantics) evaluated at `H.block_time`.
3. **Bump version** — `participants.last_valid_flip_version += 1` (or `0` on the very first insert).
4. **Schedule flips** in `participant_scheduled_flips` using the bumped `last_valid_flip_version` as the row's `version`:
   - If `participant_state` ∈ {`FUTURE`, `ACTIVE`}:
     - Insert `ENTER_ACTIVE` at `effective_from`.
     - If `effective_until` is non-null: insert `EXIT_ACTIVE` at `effective_until`.
   - If `participant_state` ∈ {`SLASHED`, `REVOKED`, `REPAID`}:
     - If `effective_from` is non-null AND `effective_from < H.block_time` (the entry had already entered `ACTIVE` before this block): insert `EXIT_ACTIVE` at the new terminal timestamp — `slashed`, `revoked`, or `repaid` respectively.
     - Otherwise: schedule nothing. Any earlier `ENTER_ACTIVE` is now `STALE` because its `version` is lower than the bumped `last_valid_flip_version`.
   - `INACTIVE` and `EXPIRED` cannot be reached by a state-affecting message at this step.

`PRIMARY KEY (participant_id, version, flip_at_time, flip_kind)` makes re-execution of the same block idempotent.

###### Per-block tick (time-driven, every block)

After every block `H` is fully ingested — **even when no message touched any `Participant`** — the indexer drains `participant_scheduled_flips`:

1. `SELECT * FROM participant_scheduled_flips WHERE status = 0 AND flip_at_time <= H.block_time ORDER BY flip_at_time ASC, participant_id ASC` (the `psf_pending_idx` partial index serves this directly).
2. For each `flip`:
   - Load `p := participants[flip.participant_id]`.
   - If `flip.version != p.last_valid_flip_version`: set `flip.status = STALE`. The schedule has since been replaced by a newer transaction-driven schedule; the old flip MUST NOT update counters.
   - Else: set `flip.status = APPLIED`, `flip.applied_height = H`, `flip.applied_time = H.block_time`, and emit a counter update with `delta = +1` for `ENTER_ACTIVE` or `delta = -1` for `EXIT_ACTIVE`.

`STALE` and `APPLIED` rows are retained for audit; future indexer versions MAY garbage-collect them.

###### Counter update (entity hierarchy walk)

A single applied flip on `p` produces multiple `entity_participant_changes` rows — one per (`entity_kind`, `entity_id`, `role_type`) affected. The walk is:

```text
let role  = p.role
let delta = +1 if flip_kind == ENTER_ACTIVE else -1
let affected = []

# 1. Participant ancestors (sub-tree owners)
let cursor = p.validator_participant_id
while cursor is not null:
    affected.push((PARTICIPANT, cursor, role))
    cursor = participants[cursor].validator_participant_id

# 2. Containing CredentialSchema
affected.push((CREDENTIAL_SCHEMA, p.schema_id, role))

# 3. Containing Ecosystem
let ecosystem_id = credential_schemas[p.schema_id].ecosystem_id
affected.push((ECOSYSTEM, ecosystem_id, role))

# 4. Global
affected.push((GLOBAL, NULL, role))

# 5. Mirror every entry above to role_type = ANY (0)
for (kind, id, _) in snapshot(affected):
    affected.push((kind, id, ANY))

# 6. Persist each delta
for (kind, id, t) in affected:
    let prev = SELECT value
               FROM   entity_participant_changes
               WHERE  entity_kind = kind
                  AND ((id IS NULL AND entity_id IS NULL) OR entity_id = id)
                  AND role_type   = t
                  AND height     <= H - 1
               ORDER BY height DESC
               LIMIT 1
               -- 0 if none
    INSERT (H, H.block_time, kind, id, t, prev + delta)
        INTO entity_participant_changes
```

Within a single block `H`, multiple flips touching the same `(entity_kind, entity_id, role_type)` collapse into the final cumulative value before commit — the `(entity_kind, entity_id, role_type, height)` primary key enforces a single row per key per block.

###### Read query

[`IDX-STATS-QRY-3 Count Participants`](#idx-stats-qry-3-count-participants) and the inline `participants*` fields on Ecosystem / CredentialSchema / Participant entries all resolve via the same one-row lookup:

```sql
SELECT value
FROM   entity_participant_changes
WHERE  entity_kind = :entity_kind
   AND ((:entity_id IS NULL AND entity_id IS NULL) OR entity_id = :entity_id)
   AND role_type   = :role_type
   AND height     <= :height        -- resolved evaluation block
ORDER  BY height DESC
LIMIT  1;
```

For an entity that has never received a flip up to `:height`, the result set is empty and the caller MUST treat it as `0`. The seven-field breakdown is obtained by running the query once per `role_type` ∈ {`ANY`, `ECOSYSTEM`, `ISSUER_GRANTOR`, `ISSUER`, `VERIFIER_GRANTOR`, `VERIFIER`, `HOLDER`}.

> Note: the `participants*` aggregates on `Corporation` ([`IDX-CO-QRY-1`](#idx-co-qry-1-get-corporation)) are scoped by `corporation_id` (all Participants owned by a Corporation across every schema and ecosystem), not by tree position, and are therefore NOT served by `entity_participant_changes` — they live outside the scope of this section.

#### Corporation methods

##### IDX-CO-QRY-1 Get Corporation

`GET /v4/corporation/get/{id}`

Retrieve a specific Corporation by its id. *Aligned with VPR [[MOD-CO-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-co-qry-1-get-corporation).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Corporation ID |
| `gf_data` | query | enum | no | `none` \| `only_active` \| `all` — controls inclusion of CGF `versions[]`. Default: `only_active`. |
| `preferred_language` | query | string | no | Preferred document language (ISO 639); affects ordering of returned CGF documents |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` — see [Conventions](#trust_data-query-parameter) |

**Response:** `{ corporation: Corporation }`. The `Corporation` object carries:

- **On-chain (VPR `Corporation`):** `id` (uint64 — primary key), `policy_address` (the on-chain account that signs on behalf of this Corporation), `did`, `language`, `active_version`, `created`, `modified`.
- **Indexer-enriched aggregates** (computed; not stored on-chain):
  - `controlled_ecosystems` — count of `Ecosystem` entries whose `corporation_id` equals this Corporation's `id`.
  - `participants` — total count of `Participant` entries owned by this Corporation across all schemas, plus per-role breakdown (`participants_ecosystem`, `participants_issuer_grantor`, …, `participants_holder`).
  - Trust-deposit snapshot (mirrored from the linked `TrustDeposit` row for this `corporation_id`): `deposit`, `share`, `refunded`, `slashed_deposit`, `repaid_deposit`, `slash_count`, `last_slashed`, `last_repaid`.
- **Nested `versions[]: GovernanceFrameworkVersion[]`** — convenience-included from the [Governance Framework module](#governance-framework-methods); these are the CGF (Corporation Governance Framework) versions, distinguishable by their non-null `corporation_id` field. Controlled by `gf_data` (omitted entirely when `gf_data` is `none`) and ordered by `preferred_language`. Each entry carries its `documents[]: GovernanceFrameworkDocument[]`.
- **Optional `trust_data`** — when set to `summary` or `full`, a [vt response object](schemas/v4/vt/response.schema.json) for the Corporation's DID is added inline; see [Conventions](#trust_data-query-parameter) for the included fields.

##### IDX-CO-QRY-2 List Corporations

`GET /v4/corporation/list`

Retrieve a paginated, filtered list of Corporations. *Aligned with VPR [[MOD-CO-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-co-qry-2-list-corporations).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `gf_data` | query | enum | no | `none` \| `only_active` \| `all` — controls inclusion of CGF `versions[]`. Default: `only_active`. |
| `preferred_language` | query | string | no | Preferred document language; affects CGF document ordering |
| `did` | query | string | no | Filter by Corporation DID |
| `policy_address` | query | string | no | Comma-separated list of `policy_address` accounts (min 1, max 64 entries). Returns only Corporations whose `policy_address` is in the list. Since `policy_address` is globally unique across Corporation entries (1:1, per VPR), each supplied address matches at most one Corporation; addresses matching no Corporation are simply not represented in the result. More than 64 entries MUST be rejected with HTTP 400. |
| `modified_after` | query | datetime | no | Only return Corporations modified strictly after this ISO 8601 datetime |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` — see [Conventions](#trust_data-query-parameter) |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ corporations: Corporation[] }`. Each entry has the same shape as [`getCorporation`](#idx-co-qry-1-get-corporation).

> **Use case for `policy_address`:** reverse-mapping Cosmos SDK `x/group` policy accounts to their Corporation entries. A client that wants to know which Corporations an account can act for as a **group member** walks `x/group` (`GroupsByMember` → `GroupPoliciesByGroup`) to obtain the candidate policy addresses, then resolves them to Corporation entries in a single call with `policy_address=<addr1>,<addr2>,…`. This is the group-membership counterpart of the operator-side discovery served by [`listOperatorAuthorizations`](#idx-de-qry-1-list-operator-authorizations) with `operator=<addr>`.

##### IDX-CO-QRY-3 Get Corporation Params

`GET /v4/corporation/params`

Retrieve the network-level Corporation module parameters. *Aligned with VPR [[MOD-CO-QRY-3]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-co-qry-3-list-module-parameters).*

(No method-specific parameters.)

**Response:** `{ params: { ... } }` — the Corporation module parameter set as defined by VPR governance (e.g. minimum trust-deposit for Corporation creation, CGF document-size limits). Exact keys are determined by the on-chain parameter set.

##### IDX-CO-QRY-4 Get Corporation History

`GET /v4/corporation/history/{id}`

Retrieve the activity timeline for a Corporation, ordered by `id` descending (newest-first). Each entry returns only the diff (changed fields), not the full state. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Corporation ID |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `ActivityTimelineResponse` with `entity_type: "Corporation"`. Each `ActivityItem`'s `msg` is one of `CreateCorporation`, `UpdateCorporation`, `AddCGFDocument`, `IncreaseCGFActiveVersion`, etc.

#### Ecosystem methods

##### IDX-ES-QRY-1 Get Ecosystem

`GET /v4/ecosystem/get/{id}`

Retrieve a specific Ecosystem by its ID. *Aligned with VPR [[MOD-ES-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-es-qry-1-get-ecosystem).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Ecosystem ID |
| `gf_data` | query | enum | no | `none` \| `only_active` \| `all` — controls inclusion of EGF `versions[]`. Default: `only_active`. |
| `preferred_language` | query | string | no | Preferred document language (ISO 639); affects ordering of returned governance-framework documents |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` — see [Conventions](#trust_data-query-parameter) |

**Response:** `{ ecosystem: Ecosystem }`. The `Ecosystem` object carries:

- **On-chain (VPR `Ecosystem`):** `id`, `did`, `corporation_id` (uint64; FK to `Corporation.id`), `language`, `active_version`, `created`, `modified`, `archived` (nullable).
- **Indexer-enriched aggregates** (computed by the indexer over related `Participant`, `CredentialSchema`, and slash-event tables; not stored on-chain):
  - Participant-role counts: `participants`, `participants_ecosystem`, `participants_issuer_grantor`, `participants_issuer`, `participants_verifier_grantor`, `participants_verifier`, `participants_holder`.
  - Schema counts: `active_schemas`, `archived_schemas`.
  - Activity totals: `weight` (int64; sum of Participant trust-deposit weights), `issued`, `verified`.
  - Slash ledger: `ecosystem_slash_events`, `ecosystem_slashed_amount`, `ecosystem_slashed_amount_repaid`, `network_slash_events`, `network_slashed_amount`, `network_slashed_amount_repaid`.
- **Nested `versions[]: GovernanceFrameworkVersion[]`** — convenience-included from the [Governance Framework module](#governance-framework-methods) so EGF data can be fetched in a single round-trip. Controlled by `gf_data` (omitted entirely when `gf_data` is `none`) and ordered by `preferred_language`. Each entry carries its `documents[]: GovernanceFrameworkDocument[]` with `language`, `url`, `digest_sri`. For the authoritative GF queries, use [`getGovernanceFrameworkVersion`](#idx-gf-qry-1-get-governance-framework-version) / [`listGovernanceFrameworkVersions`](#idx-gf-qry-2-list-governance-framework-versions).
- **Optional `trust_data`** — when set to `summary` or `full`, a [vt response object](schemas/v4/vt/response.schema.json) for the Ecosystem's DID is added inline; see [Conventions](#trust_data-query-parameter) for the included fields.

##### IDX-ES-QRY-2 List Ecosystems

`GET /v4/ecosystem/list`

Retrieve a paginated, filtered list of Ecosystems. *Aligned with VPR [[MOD-ES-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-es-qry-2-list-ecosystems).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `gf_data` | query | enum | no | `none` \| `only_active` \| `all` — controls inclusion of EGF `versions[]`. Default: `only_active`. |
| `preferred_language` | query | string | no | Preferred document language; affects governance-framework document ordering |
| `archived` | query | boolean | no | `true` → only archived Ecosystems; `false` → only not-archived Ecosystems; null/omitted → both. Default: null. |
| `corporation_id` | query | uint64 | no | Filter by controlling-Corporation id |
| `participant_corporation_id` | query | uint64 | no | Id of a Corporation; returns Ecosystems where this Corporation is the controlling Corporation (`Ecosystem.corporation_id`) **or** owns a `Participant` entry with `participant_state = ACTIVE` (per [Participant State Semantics](#participant-state-semantics)) on any Credential Schema of the Ecosystem. Complements `corporation_id`, which matches on control only |
| `modified_after` | query | datetime | no | Only return Ecosystems modified strictly after this ISO 8601 datetime |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` — see [Conventions](#trust_data-query-parameter) |
| `min_active_schemas` / `max_active_schemas` | query | integer | no | Active-schema count bounds |
| *(standard list filters)* | query | — | no | See [Standard list filters](#standard-list-filters) |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ ecosystems: Ecosystem[] }`. Each entry has the same shape as [`getEcosystem`](#idx-es-qry-1-get-ecosystem).

##### IDX-ES-QRY-3 Get Ecosystem Params

`GET /v4/ecosystem/params`

Retrieve the network-level Ecosystem module parameters. *Aligned with VPR [[MOD-ES-QRY-3]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-es-qry-3-list-module-parameters).*

(No method-specific parameters.)

**Response:** `{ params: { trust_unit_price: decimal, ecosystem_trust_deposit: decimal } }` — the price-per-trust-unit and the trust-deposit required to create an Ecosystem, as defined by the Ecosystem module parameters.

##### IDX-ES-QRY-4 Get Ecosystem History

`GET /v4/ecosystem/history/{id}`

Retrieve the activity timeline for an Ecosystem, ordered by `id` descending (newest-first). Each entry returns only the diff (changed fields), not the full state. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Ecosystem ID |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `ActivityTimelineResponse` — `{ entity_type: "Ecosystem", entity_id, activity: ActivityItem[] }`. Each `ActivityItem` has `id` (uint64; indexer-assigned monotonic per-row surrogate key, used as the pagination cursor — distinct from `entity_id`), `timestamp`, `block_height`, `entity_type`, `entity_id`, `msg` (e.g. `CreateEcosystem`, `AddGovernanceFrameworkDocument`), `account` (signer), and `changes` (object of changed fields). The same `ActivityTimelineResponse` shape is reused by every `*History` and the indexer-level `listChanges` method.

#### Governance Framework methods

The Governance Framework module surfaces `GovernanceFrameworkVersion` (GFV) and its nested `GovernanceFrameworkDocument` (GFD) entries as first-class queryable entities. A GFV belongs to exactly one owning subject — either an Ecosystem (`ecosystem_id`, an EGF) or a Corporation (`corporation_id`, a CGF) — never both.

##### IDX-GF-QRY-1 Get Governance Framework Version

`GET /v4/governance-framework/get/{id}`

Retrieve a specific `GovernanceFrameworkVersion` by its ID, with its nested `GovernanceFrameworkDocument` entries. *Aligned with VPR [[MOD-GF-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-gf-qry-1-get-governance-framework-version).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The GovernanceFrameworkVersion ID |
| `preferred_language` | query | string | no | If set, return only one document per version, preferring `preferred_language`; otherwise return all documents in all languages |

**Response:** `{ version: GovernanceFrameworkVersion }` — `id`, `ecosystem_id` (set iff this is an EGF; null otherwise), `corporation_id` (set iff this is a CGF; null otherwise), `created`, `version` (int), `active_since` (timestamp), and `documents[]: GovernanceFrameworkDocument[]` (each carrying `id`, `gfv_id`, `created`, `language`, `url`, `digest_sri`). Exactly one of `ecosystem_id` and `corporation_id` MUST be set, per VPR data model invariant.

##### IDX-GF-QRY-2 List Governance Framework Versions

`GET /v4/governance-framework/list`

Retrieve the list of `GovernanceFrameworkVersion` entries for one owning subject — either an Ecosystem or a Corporation. *Aligned with VPR [[MOD-GF-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-gf-qry-2-list-governance-framework-versions).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `ecosystem_id` | query | uint64 | conditional | Filter by owning Ecosystem. MUST be set iff `corporation_id` is null |
| `corporation_id` | query | uint64 | conditional | Filter by owning Corporation id. MUST be set iff `ecosystem_id` is null |
| `active_only` | query | boolean | no | If true, return only the entry corresponding to the subject's `active_version` |
| `preferred_language` | query | string | no | If set, return only one document per version, preferring `preferred_language` |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ versions: GovernanceFrameworkVersion[] }`. Each entry has the same shape as [`getGovernanceFrameworkVersion`](#idx-gf-qry-1-get-governance-framework-version). Exactly one of `ecosystem_id` and `corporation_id` MUST be provided in the query; otherwise HTTP 400. Within a single owning subject, ascending `id` equals ascending `version`, so clients that want chronological (oldest-first) ordering can request it with `sort=+id`.

#### Credential Schema methods

##### IDX-CS-QRY-1 Get Credential Schema

`GET /v4/credential-schema/get/{id}`

Retrieve a specific Credential Schema by its ID. *Aligned with VPR [[MOD-CS-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-cs-qry-2-get-credential-schema).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Credential Schema ID |

**Response:** `{ schema: CredentialSchema }`. The `CredentialSchema` object carries:

- **On-chain (VPR `CredentialSchema`):** `id`, `ecosystem_id` (owning Ecosystem), `json_schema` (the exact JSON Schema document as stored on-chain, preserved byte-for-byte for SRI digest verification of credentials issued under this schema), validity periods (`issuer_grantor_validation_validity_period`, `verifier_grantor_validation_validity_period`, `issuer_validation_validity_period`, `verifier_validation_validity_period`, `holder_validation_validity_period`), onboarding modes (`issuer_onboarding_mode`, `verifier_onboarding_mode`, `holder_onboarding_mode`), pricing (`pricing_asset_type`, `pricing_asset`), `digest_algorithm`, `created`, `modified`, `archived` (nullable).
- **Indexer-enriched aggregates** (computed; not stored on-chain):
  - Participant-role counts: `participants`, `participants_issuer_grantor`, `participants_issuer`, `participants_verifier_grantor`, `participants_verifier`, `participants_holder`.
  - Activity totals: `weight`, `issued`, `verified`.
  - Slash counters: `ecosystem_slash_events`, `ecosystem_slashed_amount`, `ecosystem_slashed_amount_repaid`, `network_slash_events`, `network_slashed_amount`, `network_slashed_amount_repaid`.

##### IDX-CS-QRY-2 List Credential Schemas

`GET /v4/credential-schema/list`

Retrieve a paginated, filtered list of Credential Schemas. *Aligned with VPR [[MOD-CS-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-cs-qry-1-list-credential-schemas).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `ecosystem_id` | query | uint64 | no | Filter by owning Ecosystem ID |
| `archived` | query | boolean | no | `true` → only archived schemas; `false` → only not-archived schemas; null/omitted → both. Default: null. |
| `issuer_onboarding_mode` | query | enum | no | Filter by issuer onboarding mode: `OPEN` \| `GRANTOR_ONBOARDING_PROCESS` \| `ECOSYSTEM_ONBOARDING_PROCESS` |
| `verifier_onboarding_mode` | query | enum | no | Filter by verifier onboarding mode: `OPEN` \| `GRANTOR_ONBOARDING_PROCESS` \| `ECOSYSTEM_ONBOARDING_PROCESS` |
| `holder_onboarding_mode` | query | enum | no | Filter by holder onboarding mode: `ISSUER_ONBOARDING_PROCESS` \| `PERMISSIONLESS` |
| `participant_corporation_id` | query | uint64 | no | Id of a Corporation; returns schemas where this Corporation controls the owning Ecosystem (`Ecosystem.corporation_id`) **or** owns a `Participant` entry with `participant_state = ACTIVE` (per [Participant State Semantics](#participant-state-semantics)) on the schema |
| `modified_after` | query | datetime | no | Only return schemas modified strictly after this datetime |
| *(standard list filters)* | query | — | no | See [Standard list filters](#standard-list-filters) |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ schemas: CredentialSchema[] }`. Each entry has the same shape as [`getCredentialSchema`](#idx-cs-qry-1-get-credential-schema).

##### IDX-CS-QRY-3 Get JSON Schema

`GET /v4/credential-schema/js/{id}`

Retrieve the canonical JSON Schema document for a specific Credential Schema, with `$id` rewritten to the indexer's canonical VPR URI form (e.g. `vpr:verana:vna-testnet-1:cs:16`). *Aligned with VPR [[MOD-CS-QRY-3]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-cs-qry-3-render-json-schema).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Credential Schema ID |

**Response:** The raw JSON Schema object as stored on-chain, with only the `$id` field overridden by the indexer. The body is `Content-Type: application/json`; clients SHOULD use this endpoint as the canonical schema-resolution target when dereferencing `vpr:verana:...:cs:<n>` URIs.

##### IDX-CS-QRY-4 Get Credential Schema Params

`GET /v4/credential-schema/params`

Retrieve the network-level Credential Schema module parameters. *Aligned with VPR [[MOD-CS-QRY-4]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-cs-qry-4-list-module-parameters).*

(No method-specific parameters.)

**Response:** `{ params: { credential_schema_trust_deposit: decimal } }` — the trust-deposit required to register a Credential Schema, as defined by the Credential Schema module parameters.

##### IDX-CS-QRY-5 Get Credential Schema History

`GET /v4/credential-schema/history/{id}`

Retrieve the activity timeline for a Credential Schema, ordered by `id` descending (newest-first). Same shape as [`getEcosystemHistory`](#idx-es-qry-4-get-ecosystem-history) with `entity_type: "CredentialSchema"`. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Credential Schema ID |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `ActivityTimelineResponse` with `entity_type: "CredentialSchema"`.

#### Participant methods

##### IDX-PP-QRY-1 Get Participant

`GET /v4/participant/get/{id}`

Retrieve a specific Participant by its ID. A Participant is a single VPR participant entry — a binding of a Corporation/DID into a Credential Schema with a specific role and lifecycle. *Aligned with VPR [[MOD-PP-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-qry-2-get-participant).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Participant ID |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` |

**Response:** `{ participant: Participant }`. The `Participant` object carries:

- **On-chain (VPR `Participant`):** `id`, `schema_id`, `role` (one of `ISSUER`, `VERIFIER`, `ISSUER_GRANTOR`, `VERIFIER_GRANTOR`, `ECOSYSTEM`, `HOLDER`), `did`, `corporation_id` (uint64; FK to `Corporation.id`), `vs_operator` (account), lifecycle timestamps (`created`, `modified`, `adjusted`, `slashed`, `repaid`, `revoked`, `effective_from`, `effective_until`), fee fields (`validation_fees`, `issuance_fees`, `verification_fees`, `issuance_fee_discount`, `verification_fee_discount`), deposit fields (`deposit`, `slashed_deposit`, `repaid_deposit`), and the onboarding-process state (`op_state` enum: `PENDING` / `VALIDATED` / `TERMINATED`; plus `op_last_state_change`, `op_current_fees`, `op_current_deposit`, `op_summary_digest`, `op_exp`, `op_validator_deposit`, `validator_participant_id`).
- **Indexer-derived (computed at evaluation block; not stored on-chain):**
  - `ecosystem_id` — the Ecosystem owning the Participant's Credential Schema, denormalised from `CredentialSchema.ecosystem_id`. Per VPR, every schema is owned by exactly one Ecosystem, so the value is well-defined and immutable for the Participant's lifetime; it saves consumers a schema→ecosystem join per row and mirrors the `participations[].ecosystemId` field the [Verifiable Trust Resolver](#verifiable-trust-resolver-methods) already surfaces inline.
  - `participant_state` — lifecycle state derived from on-chain timestamps. One of `ACTIVE`, `FUTURE`, `INACTIVE`, `EXPIRED`, `REVOKED`, `SLASHED`, `REPAID`. See [Conventions → `participant_state` semantics](#participant-state-semantics).
  - `corporation_available_actions[]`, `validator_available_actions[]` — UI-affordance arrays listing the next allowable VPR messages for the owning Corporation / validator at the current state (e.g. `CancelParticipantOPLastRequest`, `SetParticipantOPtoValidated`, `RenewParticipantOP`). See [Conventions → Available Actions Semantics](#available-actions-semantics).
- **Indexer-enriched aggregates** (computed): `weight`, `issued`, `verified`, `participants` (sub-participant count for grantor roles), and the same slash counters as on `CredentialSchema`.
- **VS-operator authorization grants** for this `Participant.id` are **not** surfaced inline. Query them via [`listVSOperatorAuthorizations`](#idx-de-qry-2-list-vs-operator-authorizations) filtered by `participant_id` — they live in `ParticipantAuthorizationRecord` entries (formerly the `Participant.vs_operator_authz_*` fields).
- **Optional `trust_data`** — when set to `summary` or `full`, a [vt response object](schemas/v4/vt/response.schema.json) for the Participant's DID is added inline; see [Conventions](#trust_data-query-parameter) for the included fields.

##### IDX-PP-QRY-2 List Participants

`GET /v4/participant/list`

Retrieve a paginated, filtered list of Participants. *Aligned with VPR [[MOD-PP-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-qry-1-list-participants).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | query | uint64 | no | Filter by participant-owner Corporation id |
| `did` | query | string | no | Filter by DID |
| `participant_id` | query | uint64 | no | Filter by exact Participant ID |
| `role` | query | enum | no | `ISSUER` \| `VERIFIER` \| `ISSUER_GRANTOR` \| `VERIFIER_GRANTOR` \| `ECOSYSTEM` \| `HOLDER` |
| `participant_state` | query | enum | no | Indexer-derived lifecycle state: `REPAID` \| `SLASHED` \| `REVOKED` \| `EXPIRED` \| `ACTIVE` \| `FUTURE` \| `INACTIVE` |
| `op_state` | query | enum | no | `PENDING` \| `VALIDATED` \| `TERMINATED` |
| `only_valid` | query | boolean | no | Filter only valid (non-slashed, non-revoked, non-expired) Participants |
| `only_slashed` | query | boolean | no | Filter only slashed Participants |
| `only_repaid` | query | boolean | no | Filter only repaid Participants |
| `schema_id` | query | uint64 | no | Filter by Credential Schema ID |
| `ecosystem_id` | query | uint64 | no | Filter by the Ecosystem owning the Participant's Credential Schema (the denormalised `ecosystem_id` response field) |
| `validator_participant_id` | query | uint64 | no | Filter by validator Participant ID |
| `when` | query | datetime | no | Effective-date filter; returns Participants whose effective range includes this datetime |
| `modified_after` | query | datetime | no | Only return Participants modified strictly after this datetime |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` |
| *(standard list filters)* | query | — | no | See [Standard list filters](#standard-list-filters) |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ participants: Participant[] }`. Each entry has the same shape as [`getParticipant`](#idx-pp-qry-1-get-participant).

##### IDX-PP-QRY-3 Get Participant History

`GET /v4/participant/history/{id}`

Retrieve the activity timeline for a Participant, ordered by `id` descending (newest-first). *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The Participant ID |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `ActivityTimelineResponse` with `entity_type: "Participant"`.

##### IDX-PP-QRY-4 Find Beneficiaries

`GET /v4/participant/beneficiaries`

Compute the set of beneficiary Participants for a credential transaction. Given an issuer Participant and/or a verifier Participant, returns every ancestor Participant in the involved tree branch(es) (issuer grantor, verifier grantor, ecosystem) that participates in the fee-distribution flow. *Aligned with VPR [[MOD-PP-QRY-4]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-qry-4-find-beneficiaries).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `issuer_participant_id` | query | uint64 | conditional¹ | Issuer Participant ID. MUST reference an [active](#participant-state-semantics) `Participant`; HTTP 400 otherwise |
| `verifier_participant_id` | query | uint64 | conditional¹ | Verifier Participant ID. MUST reference an [active](#participant-state-semantics) `Participant`; HTTP 400 otherwise |

¹ At least one of `issuer_participant_id` and `verifier_participant_id` MUST be provided (either one alone, or both); providing neither is HTTP 400. Per VPR [[MOD-PP-QRY-4]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-qry-4-find-beneficiaries), the membership of the result set depends on the combination:

- **Issuance** (`issuer_participant_id` only — a credential offer): the ancestors of the issuer `Participant`, excluding the issuer itself.
- **Verification** (`verifier_participant_id` set, with or without `issuer_participant_id`): the ancestors of the verifier `Participant` (excluding the verifier itself), plus — when `issuer_participant_id` is provided — the issuer `Participant` **itself** and its ancestors.

In both cases, revoked and slashed ancestors are excluded from the set; expired-but-not-revoked/slashed ancestors are included.

**Response:** `{ participants: Participant[] }` — the set of beneficiary Participants.

##### IDX-PP-QRY-5 Pending Flat

`GET /v4/participant/pending/flat`

Return the open task list for a given Corporation — every Participant anywhere on the network whose **validator Participant** (the entry referenced by its `validator_participant_id`) is owned by that Corporation and whose state requires the validator's action (e.g. `op_state: PENDING`). Results are grouped by Ecosystem then by Credential Schema. *Indexer-specific (no VPR equivalent).*

> Validator scoping is by Corporation, not by account: per VPR v4, `Participant` entries — including validator entries — are owned by Corporations (`Participant.corporation_id`), and individual accounts only act on them through delegated authorizations. A client acting for a Corporation (e.g. the Verana frontend after corporation selection) passes that Corporation's `corporation_id`; which of the Corporation's operators may actually execute the pending action (`SetParticipantOPtoValidated`, …) is determined separately by the caller against the Corporation's authorization grants (see [`listOperatorAuthorizations`](#idx-de-qry-1-list-operator-authorizations) / [`listVSOperatorAuthorizations`](#idx-de-qry-2-list-vs-operator-authorizations) and [Available Actions Semantics](#available-actions-semantics)).

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | query | uint64 | yes | Id of the Corporation whose pending tasks are returned (the Corporation owning the validator `Participant` entries) |
| `trust_data` | query | enum | no | `null` \| `summary` \| `full` |
| `limit` | query | integer | no | 1..1024, default 64 (caps the number of Ecosystems returned) |

**Response:** `{ ecosystems: EcosystemPending[] }`. Each `EcosystemPending` carries:

- `id`, `did`, `pending_tasks` (count of pending validations), `participants` (active participant count).
- `trust_data` (when requested; per [Conventions](#trust_data-query-parameter)).
- `schemas[]: CredentialSchemaPending[]` — each `CredentialSchemaPending` carries `id`, `title` (indexer-derived from the JSON Schema `title`), `description` (indexer-derived from the JSON Schema `description`), `pending_tasks`, `participants` (active participant count), and `pending_participants[]: Participant[]` (full `Participant` shape; see [`getParticipant`](#idx-pp-qry-1-get-participant)). The `pending_participants[]` array is the list of `Participant` entries pending action from the validator Corporation; it is intentionally distinct from the scalar `participants` count.

##### IDX-PP-QRY-6 Get Participant Session

`GET /v4/participant/participant-session/{id}`

Retrieve a specific ParticipantSession by its UUID. A ParticipantSession binds an end-user agent into one (or more) Issuer/Verifier participant contexts for the lifetime of a credential-exchange flow. *Aligned with VPR [[MOD-PP-QRY-5]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-qry-5-get-participantsession).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uuid | yes | ParticipantSession UUID |

**Response:** `{ session: ParticipantSession }`. The `ParticipantSession` object carries:

- **On-chain (VPR `ParticipantSession`):** `id` (UUID), `corporation_id` (the agent's controlling Corporation), `vs_operator` (the VS-operator account that controls the session), `created`, `modified`.
- **Nested `session_records[]: ParticipantSessionRecord[]`** — each `ParticipantSessionRecord` carries `created`, `issuer_participant_id` (optional), `verifier_participant_id` (optional), `wallet_agent_participant_id` (optional), `agent_participant_id` (optional).

##### IDX-PP-QRY-7 Get Participant Session History

`GET /v4/participant/participant-session-history/{id}`

Retrieve the activity timeline for a ParticipantSession, ordered by `id` descending (newest-first). *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uuid | yes | ParticipantSession UUID |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `ActivityTimelineResponse` with `entity_type: "ParticipantSession"`.

##### IDX-PP-QRY-8 Get Participant Params

`GET /v4/participant/params`

Retrieve the network-level Participant module parameters. *Aligned with VPR [[MOD-PP-QRY-6]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-qry-6-list-participant-module-parameters).*

(No method-specific parameters.)

**Response:** `{ params: { ... } }` — the Participant module parameter set as defined by VPR governance (e.g. trust-deposit requirements per role, validation-fee floors). Exact keys are determined by the on-chain parameter set.

#### Trust Deposit methods

##### IDX-TD-QRY-1 Get Trust Deposit By Corporation

`GET /v4/trust-deposit/get/{corporation_id}`

Retrieve the aggregated trust-deposit position of a single Corporation across every entity it owns (Ecosystems, Credential Schemas, Participants). Per VPR, every Corporation has at most one TrustDeposit row (1:1 by `corporation_id`). *Aligned with VPR [[MOD-TD-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-td-qry-1-get-trust-deposit).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | path | uint64 | yes | The Corporation ID |

**Response:** `{ trust_deposit: TrustDeposit }`. The `TrustDeposit` object carries:

- **On-chain (VPR `TrustDeposit`):** `corporation_id` (uint64; primary key — references `Corporation.id`, 1:1), `deposit` (current locked amount in native denom, integer), `share` (this Corporation's share of the module-pooled deposit), `refunded` (reused-first refunded amount, drawn before pulling from the Corporation's `policy_address`), `slashed_deposit`, `repaid_deposit`, `last_slashed` (timestamp, nullable), `last_repaid` (timestamp, nullable), `slash_count`.
- **Indexer-derived (computed; not stored on-chain):** `claimable` — accrued yield currently claimable on reclaim, computed as `share * trust_deposit_share_value - deposit` per the network's Trust Deposit module parameters.

##### IDX-TD-QRY-2 Get Trust Deposit Params

`GET /v4/trust-deposit/params`

Retrieve the network-level Trust Deposit module parameters. *Aligned with VPR [[MOD-TD-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-td-qry-2-list-module-parameters).*

(No method-specific parameters.)

**Response:** `{ params: { trust_deposit_rate, user_agent_reward_rate, trust_deposit_share_value, wallet_user_agent_reward_rate, trust_deposit_reclaim_burn_rate } }` — all decimals; the network governance rates that drive yield, reward distribution, share-value translation, and the burn fraction applied on reclaim.

##### IDX-TD-QRY-3 Get Trust Deposit History

`GET /v4/trust-deposit/history/{corporation_id}`

Retrieve the activity timeline for a Trust Deposit row, ordered by `id` descending (newest-first). *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | path | uint64 | yes | The Corporation ID (the TrustDeposit row is identified 1:1 by `corporation_id`) |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `ActivityTimelineResponse` with `entity_type: "TrustDeposit"`. Each `ActivityItem`'s `msg` is one of `CREATE_TRUST_DEPOSIT`, `ADJUST_TRUST_DEPOSIT`, `SLASH_TRUST_DEPOSIT`, `SLASH_PARTICIPANT_TRUST_DEPOSIT`, `RECLAIM_YIELD`, `RECLAIM_DEPOSIT`, `REPAY_SLASHED`.

#### Delegation methods

The Delegation module surfaces the two on-chain authorization entities that replaced the old `Participant.vs_operator_authz_*` fields: `OperatorAuthorization` (corporation-to-operator grants over module message types) and `VSOperatorAuthorization` (corporation-to-VS-operator grant container holding one `ParticipantAuthorizationRecord` per controlled `Participant`) — plus the `FeeGrant` entries through which a Corporation pays transaction fees on behalf of its grantees.

##### IDX-DE-QRY-1 List Operator Authorizations

`GET /v4/delegation/operator-authorizations`

Retrieve a paginated, filtered list of `OperatorAuthorization` entries. Each entry represents a corporation's authorization granted to a specific operator account for one or more module message types. *Aligned with VPR [[MOD-DE-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-de-qry-1-list-operator-authorizations).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | query | uint64 | no | Filter by the granting Corporation id |
| `operator` | query | string | no | Filter by the grantee operator account |
| `msg_type` | query | string | no | Filter to authorizations whose `msg_types[]` includes this message type |
| `only_active` | query | boolean | no | If true, only return non-expired authorizations (`expiration > now` or null) |
| `modified_after` | query | datetime | no | Only return authorizations modified strictly after this datetime |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ authorizations: OperatorAuthorization[] }` — each entry carries `id` (auto-incremented uint64), `corporation_id`, `operator`, `msg_types[]`, `spend_limit[]` (optional `DenomAmount[]`), `remaining_spend[]` (when `spend_limit` is set), `expiration` (optional timestamp), and `period` (optional duration).

> Fee-payment capability is **not** part of `OperatorAuthorization`: per the VPR data model it lives on the separate [FeeGrant](https://verana-labs.github.io/verifiable-trust-vpr-spec/versions/v4/#feegrant) entity, keyed `(grantor_corporation_id, grantee)`. Query it via [`listFeeGrants`](#idx-de-qry-5-list-fee-grants).

##### IDX-DE-QRY-2 List VS Operator Authorizations

`GET /v4/delegation/vs-operator-authorizations`

Retrieve a paginated, filtered list of `VSOperatorAuthorization` entries. Each entry has its own `id` (auto-incremented uint64) and is uniquely identified by the `(corporation_id, vs_operator)` pair; it holds the `ParticipantAuthorizationRecord[]` array — one record per `Participant` whose VS-operator authorization is delegated to that `vs_operator`. *Aligned with VPR [[MOD-DE-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-de-qry-2-list-vs-operator-authorizations).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | query | uint64 | no | Filter by the granting Corporation id |
| `vs_operator` | query | string | no | Filter by the grantee VS-operator account |
| `participant_id` | query | uint64 | no | Filter to entries whose `records[]` contains a record for this `Participant.id` |
| `only_active` | query | boolean | no | If true, only return entries with at least one non-expired record |
| `modified_after` | query | datetime | no | Only return entries modified strictly after this datetime |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ authorizations: VSOperatorAuthorization[] }` — each entry carries `id` (auto-incremented uint64), `corporation_id`, `vs_operator`, and `records[]: ParticipantAuthorizationRecord[]`. Each `ParticipantAuthorizationRecord` carries `participant_id` (globally unique), `msg_types[]`, `spend_limit[]` (optional), `remaining_spend[]` (when `spend_limit` is set), `fee_spend_limit[]` (optional), `remaining_fee_spend[]` (when `fee_spend_limit` is set), `with_feegrant` (boolean), `expiration` (timestamp), and `period` (optional duration). This is the canonical surface for the data that was previously inlined as `Participant.vs_operator_authz_*` fields.

##### IDX-DE-QRY-3 Get Operator Authorization

`GET /v4/delegation/operator-authorization/{id}`

Retrieve a specific `OperatorAuthorization` entry by its id. *Aligned with VPR [[MOD-DE-QRY-3]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-de-qry-3-get-operator-authorization).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The OperatorAuthorization ID |

**Response:** `{ authorization: OperatorAuthorization }` — same shape as an entry returned by [`listOperatorAuthorizations`](#idx-de-qry-1-list-operator-authorizations): `id`, `corporation_id`, `operator`, `msg_types[]`, `spend_limit[]` (optional `DenomAmount[]`), `remaining_spend[]` (when `spend_limit` is set), `expiration` (optional timestamp), and `period` (optional duration). For the associated fee-payment capability, see [`listFeeGrants`](#idx-de-qry-5-list-fee-grants).

##### IDX-DE-QRY-4 Get VS Operator Authorization

`GET /v4/delegation/vs-operator-authorization/{id}`

Retrieve a specific `VSOperatorAuthorization` entry by its id, including its nested `records[]`. *Aligned with VPR [[MOD-DE-QRY-4]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-de-qry-4-get-vs-operator-authorization).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The VSOperatorAuthorization ID |

**Response:** `{ authorization: VSOperatorAuthorization }` — same shape as an entry returned by [`listVSOperatorAuthorizations`](#idx-de-qry-2-list-vs-operator-authorizations): `id`, `corporation_id`, `vs_operator`, and `records[]: ParticipantAuthorizationRecord[]` (each record carries `participant_id`, `msg_types[]`, `spend_limit[]` and `remaining_spend[]`, `fee_spend_limit[]` and `remaining_fee_spend[]`, `with_feegrant`, `expiration`, `period`).

##### IDX-DE-QRY-5 List Fee Grants

`GET /v4/delegation/fee-grants`

Retrieve a paginated, filtered list of `FeeGrant` entries — the grants through which a Corporation pays network transaction fees on behalf of a grantee account (an `operator` or a `vs_operator`). *Aligned with the VPR [FeeGrant](https://verana-labs.github.io/verifiable-trust-vpr-spec/versions/v4/#feegrant) entity and [Delegation Module](https://verana-labs.github.io/verifiable-trust-vpr-spec/versions/v4/#delegation-module) fee-grant model; no dedicated VPR query exists (grants are realized as `x/feegrant` allowances).*

The primary consumer use case is a client deciding, before broadcasting a delegable Msg, whether the signing grantee can elect corporation-paid fees by setting the transaction's fee `granter` to the Corporation's `policy_address`: a single call with `grantor_corporation_id=<acting corporation>&grantee=<signing account>&msg_type=<Msg type>&only_active=true` answers it (the `(grantor_corporation_id, grantee)` pair is the FeeGrant's composite key, so at most one entry matches).

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `grantor_corporation_id` | query | uint64 | no | Filter by the granting Corporation id |
| `grantee` | query | string | no | Filter by the grantee account |
| `msg_type` | query | string | no | Filter to grants whose `msg_types[]` includes this message type |
| `only_active` | query | boolean | no | If true, only return non-expired grants (`expiration > now` or null; for periodic grants, the auto-renewing cycle boundary never makes the grant inactive) |
| `modified_after` | query | datetime | no | Only return grants modified strictly after this datetime. A grant is considered modified by its creation, update, or revocation, and by any change to `remaining_spend` (fee draw or cycle reset, detected via the SDK `use_feegrant` event — fee draws happen at fee-processing time and emit no Delegation-module event of their own) |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination). Since the VPR `FeeGrant` has a composite primary key `(grantor_corporation_id, grantee)` and no `id` of its own, the cursor key is an indexer-assigned per-row monotonic uint64 `id` surfaced on each entry (same mechanic as `ActivityItem.id`), distinct from any on-chain identifier.

**Response:** `{ fee_grants: FeeGrant[] }` — each entry carries `id` (indexer-assigned per-row uint64, the pagination cursor), `grantor_corporation_id`, `grantee`, `msg_types[]`, `spend_limit[]` (optional `DenomAmount[]`), `remaining_spend[]` (when `spend_limit` is set — sourced from the underlying `x/feegrant` allowance's running balance, per the VPR Delegation module realization note), `expiration` (optional timestamp), and `period` (optional duration). For periodic grants, `expiration` reflects the underlying allowance's current `period_reset` (the end of the current auto-renewing cycle), per the VPR Delegation module mapping — not the value stored at grant time, which never advances on-chain.

#### Digest methods

##### IDX-DI-QRY-1 Get Digest

`GET /v4/di/get/{digest}`

Look up a previously stored `Digest` entry by its digest string. *Aligned with VPR [[MOD-DI-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-di-qry-1-get-digest).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `digest` | path | string | yes | The digest to look up, byte-for-byte as anchored (for a credential, its `digestJCS`) |

**Response:** `{ digest: Digest }` — `{ digest: string, created: timestamp }`. Returns HTTP 404 if no `Digest` entry exists for the supplied value.

#### Group methods

The Verana chain uses the Cosmos SDK `x/group` module for Corporation governance: every Corporation is anchored on a group policy account (its `policy_address`), and corporation-level decisions — operator grants, member changes, every non-delegable Msg — are taken through group proposals (see the VPR [Corporation Module](https://verana-labs.github.io/verifiable-trust-vpr-spec/versions/v4/#corporation-module) group-lifecycle note). The Group module surfaces this `x/group` state **scoped to Corporation-anchored groups** — the group whose policy is some Corporation's `policy_address` — so that clients can implement membership discovery, member lists, and the full proposal/vote lifecycle without querying a chain LCD node. Groups and group policies that anchor no Corporation are out of scope and MUST NOT be surfaced.

Write operations remain out of scope: submitting, voting on, executing, and withdrawing proposals (`MsgSubmitProposal`, `MsgVote`, `MsgExec`, `MsgWithdrawProposal`) are ordinary transactions broadcast to the chain; this module provides the read view, and [`IDX-INDEXER-SUB-1`](#idx-indexer-sub-1-subscribe-indexer-events) delivers the corresponding events in real time (see its routing model).

*All methods in this module are indexer-specific (no VPR equivalent; they mirror Cosmos SDK `x/group` queries, joined with Corporation entries).*

##### IDX-GR-QRY-1 Get Corporation Group

`GET /v4/group/get/{corporation_id}`

Retrieve the `x/group` state backing a Corporation: the group, the group policy anchoring the Corporation, and the full member list.

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | path | uint64 | yes | The Corporation ID |

**Response:** `{ group: CorporationGroup }`. The `CorporationGroup` object carries:

- `corporation_id` — echo of the path parameter.
- **Group:** `group_id` (uint64), `version` (bumped on membership changes), `total_weight` (decimal string), `created_at`.
- **Policy:** `policy: { address, version, decision_policy }` — `address` equals the Corporation's `policy_address`; `decision_policy` is the `x/group` decision policy surfaced verbatim (a `ThresholdDecisionPolicy` `{ threshold, windows: { voting_period, min_execution_period } }` or a `PercentageDecisionPolicy` `{ percentage, windows: { … } }`).
- **Members:** `members[]` — each `{ address, weight (decimal string), metadata, added_at }`. The full list is returned inline, not paginated: corporation groups are small by construction.

The group and policy admin is not surfaced separately: per [[MOD-CO-MSG-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/versions/v4/#mod-co-msg-1-create-new-corporation), `group_policy_as_admin` is always `true`, so the admin of both the group and the group policy is the `policy.address` itself.

##### IDX-GR-QRY-2 List Corporations By Member

`GET /v4/group/corporations-by-member`

Retrieve the Corporations whose backing group has the supplied account as a current member. This is the single-call **group-membership discovery** method: it replaces the LCD walk `GroupsByMember` → `GroupPoliciesByGroup` → Corporation reverse-mapping, and is the group-member counterpart of the operator-side discovery served by [`listOperatorAuthorizations`](#idx-de-qry-1-list-operator-authorizations) with `operator=<addr>`.

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `account` | query | string | yes | Member account address |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination); the cursor key is `corporation_id`.

**Response:** `{ memberships: CorporationMembership[] }` — each entry carries `corporation_id`, `weight` (the member's weight in that group, decimal string), `metadata`, and `added_at`.

##### IDX-GR-QRY-3 List Proposals

`GET /v4/group/proposals`

Retrieve a paginated, filtered list of `x/group` proposals targeting Corporation-anchored group policies.

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `corporation_id` | query | uint64 | no | Filter by the Corporation whose group policy the proposal targets |
| `status` | query | enum | no | `SUBMITTED` \| `ACCEPTED` \| `REJECTED` \| `ABORTED` \| `WITHDRAWN` — short forms of the `x/group` `PROPOSAL_STATUS_*` values |
| `proposer` | query | string | no | Filter to proposals whose `proposers[]` includes this account |
| `pending_voter` | query | string | no | Only proposals with `status = SUBMITTED` whose voting period has not ended, where this account is a current member of the backing group and has not yet cast a vote. This is the "proposals awaiting my vote" badge query |
| `modified_after` | query | datetime | no | Only return proposals modified (submitted, voted on, tallied, executed, withdrawn) strictly after this datetime |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination); the cursor key is the proposal `id` (`x/group` proposal ids are globally unique and monotonic).

**Response:** `{ proposals: Proposal[] }`. Each `Proposal` carries:

- **On-chain (`x/group`):** `id` (uint64), `group_policy_address`, `metadata`, `proposers[]`, `submit_time`, `group_version`, `group_policy_version`, `status` (enum above), `voting_period_end`, `executor_result` (`NOT_RUN` \| `SUCCESS` \| `FAILURE` — short forms of `PROPOSAL_EXECUTOR_RESULT_*`), `messages[]` — the wrapped Msgs JSON-decoded with their `@type`, so clients can render what the proposal will execute without protobuf decoding — and `final_tally_result` (populated by `x/group` once the proposal closes).
- **Indexer-derived:** `corporation_id` (the Corporation anchored on `group_policy_address`) and `tally` `{ yes_count, no_count, abstain_count, no_with_veto_count }` — the running tally computed over indexed votes at the evaluation block; equals `final_tally_result` once the proposal closes.

##### IDX-GR-QRY-4 Get Proposal

`GET /v4/group/proposal/{id}`

Retrieve a single proposal by its `x/group` proposal id.

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | uint64 | yes | The proposal ID |

**Response:** `{ proposal: Proposal }` — same shape as an entry returned by [`listProposals`](#idx-gr-qry-3-list-proposals). Returns HTTP 404 for proposals that target no Corporation-anchored group policy.

##### IDX-GR-QRY-5 List Votes

`GET /v4/group/votes`

Retrieve the votes cast on Corporation-anchored proposals.

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `proposal_id` | query | uint64 | conditional¹ | Filter by proposal |
| `voter` | query | string | conditional¹ | Filter by voter account |

¹ At least one of `proposal_id` and `voter` MUST be provided; providing neither is HTTP 400.

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination). Since an `x/group` vote is keyed by the composite `(proposal_id, voter)`, the cursor key is an indexer-assigned per-row monotonic uint64 `id` surfaced on each entry (same mechanic as `ActivityItem.id`).

**Response:** `{ votes: Vote[] }` — each entry carries `id` (indexer-assigned per-row uint64, the pagination cursor), `proposal_id`, `voter`, `option` (`YES` \| `NO` \| `ABSTAIN` \| `NO_WITH_VETO` — short forms of `VOTE_OPTION_*`), `metadata`, and `submit_time`.

#### Exchange Rate methods

The Exchange Rate module is a protocol-level oracle that publishes on-chain conversion rates between asset pairs (`(base_asset_type, base_asset)` → `(quote_asset_type, quote_asset)`), and exposes a derived `getPrice` helper that performs the integer arithmetic conversion. Rates are scoped to the network, not to a corporation, and update permission is governed by `ExchangeRateAuthorization` entries.

##### IDX-XR-QRY-1 Get Exchange Rate

`GET /v4/exchange-rate/get`

Retrieve a single `ExchangeRate` entry, either by its primary key `id` or by the natural composite asset-pair key. *Aligned with VPR [[MOD-XR-QRY-1]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-xr-qry-1-get-exchange-rate).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | query | uint64 | conditional¹ | Primary-key lookup |
| `base_asset_type` | query | enum | conditional¹ | `TU` \| `COIN` \| `FIAT` |
| `base_asset` | query | string | conditional¹ | Base asset identifier (`"tu"` for `TU`; on-chain denom for `COIN`; ISO-4217 currency code for `FIAT`) |
| `quote_asset_type` | query | enum | conditional¹ | `TU` \| `COIN` \| `FIAT` |
| `quote_asset` | query | string | conditional¹ | Quote asset identifier (same rules as `base_asset`) |
| `state` | query | boolean | no | Force-filter on `state` (`true` enabled / `false` disabled). When omitted, both are returned |
| `expire_ts` | query | datetime | no | Return only if `expires > expire_ts` |

¹ Either `id` MUST be provided, **or** the full four-tuple (`base_asset_type`, `base_asset`, `quote_asset_type`, `quote_asset`) MUST be provided.

**Response:** `{ exchange_rate: ExchangeRate }` — `id`, `base_asset_type`, `base_asset`, `quote_asset_type`, `quote_asset`, `rate` (string; base-10 unsigned integer), `rate_scale` (uint32; number of decimal digits used to scale `rate`), `validity_duration` (duration), `updated` (timestamp), `expires` (timestamp), `state` (boolean — true means enabled).

##### IDX-XR-QRY-2 List Exchange Rates

`GET /v4/exchange-rate/list`

Retrieve a paginated, filtered list of `ExchangeRate` entries. *Aligned with VPR [[MOD-XR-QRY-2]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-xr-qry-2-list-exchange-rates).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `base_asset_type` | query | enum | no | Filter on base asset type |
| `base_asset` | query | string | no | Filter on base asset identifier |
| `quote_asset_type` | query | enum | no | Filter on quote asset type |
| `quote_asset` | query | string | no | Filter on quote asset identifier |
| `state` | query | boolean | no | Filter on `state` |
| `expire` | query | datetime | no | Return only entries whose `expires > expire` |

Supports pagination through attributes `max_id`, `min_id`, `limit` and `sort`, as explained in [Pagination](#pagination).

**Response:** `{ exchange_rates: ExchangeRate[] }`. Each entry has the same shape as [`getExchangeRate`](#idx-xr-qry-1-get-exchange-rate).

##### IDX-XR-QRY-3 Get Price

`GET /v4/exchange-rate/price`

Convert an amount of a base asset to its equivalent in a quote asset using the relevant active, non-expired `ExchangeRate` entry. *Aligned with VPR [[MOD-XR-QRY-3]](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-xr-qry-3-get-price).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `base_asset_type` | query | enum | yes | `TU` \| `COIN` \| `FIAT` |
| `base_asset` | query | string | yes | Base asset identifier |
| `quote_asset_type` | query | enum | yes | `TU` \| `COIN` \| `FIAT` |
| `quote_asset` | query | string | yes | Quote asset identifier |
| `amount` | query | string | yes | Base-asset amount expressed as a base-10 unsigned integer string, in the base asset's base units |

**Response:** `{ price: string, base_asset_type, base_asset, quote_asset_type, quote_asset, rate, rate_scale, expires }` where `price` is a base-10 unsigned integer string in the quote asset's base units. When `(base_asset_type, base_asset) == (quote_asset_type, quote_asset)`, `price == amount` and rate fields are omitted. Otherwise `price = floor(amount * rate / 10^rate_scale)`, integer arithmetic, rounded down. If no matching `ExchangeRate` entry exists, is disabled, or is expired, the response is HTTP 404 / 410.

#### Metrics methods

##### IDX-METRICS-QRY-1 Get Global Metrics

`GET /v4/metrics/all`

Return network-wide aggregate metrics across all Ecosystems, Credential Schemas, and Participants at the current (or historical, via `At-Block-Height`) block. *Indexer-specific (no VPR equivalent).*

(No method-specific parameters.)

**Response:** `GlobalMetricsResponse` — totals per metric: `participants` (and the per-role breakdown `participants_ecosystem`, `participants_issuer_grantor`, `participants_issuer`, `participants_verifier_grantor`, `participants_verifier`, `participants_holder`), `active_ecosystems`, `archived_ecosystems`, `active_schemas`, `archived_schemas`, `weight` (int64), `issued`, `verified`, and the slash ledger (`ecosystem_slash_events`, `ecosystem_slashed_amount`, `ecosystem_slashed_amount_repaid`, `network_slash_events`, `network_slashed_amount`, `network_slashed_amount_repaid`).

#### Statistics methods

The indexer maintains a pre-aggregated **time-bucketed statistics** table refreshed at every block, and exposes it through three query endpoints. Buckets are partitioned by granularity, entity scope, and bucket timestamp.

##### Statistics Persistence Model

Each row in the `stats` table is uniquely identified by the composite key `(granularity, timestamp, entity_type, entity_id)`. The `id` column is a generated surrogate primary key used by [`IDX-STATS-QRY-1 Get Stats`](#idx-stats-qry-1-get-stats) for direct lookup.

###### Granularities

- `HOUR` — bucket starts at `T..:00:00Z` of each UTC hour.
- `DAY` — bucket starts at `T00:00:00Z` of each UTC day.
- `MONTH` — bucket starts at the first instant of each UTC month.

All timestamps are stored and compared at UTC; no time-zone translation is performed.

###### Entity types

| `entity_type` | `entity_id` |
| --- | --- |
| `GLOBAL` | `null` |
| `ECOSYSTEM` | `Ecosystem.id` |
| `CREDENTIAL_SCHEMA` | `CredentialSchema.id` |
| `PARTICIPANT` | `Participant.id` (the row aggregates the sub-tree rooted at this `Participant`) |

###### Metric columns

Every row carries two parallel families of integer columns — `cumulative_*` and `delta_*` — for each of the tracked metrics:

| Metric | `cumulative_*` meaning | Notes |
| --- | --- | --- |
| `participants` | Active `Participant` count at the close of the bucket. | Sub-tree count if `entity_type = PARTICIPANT`; see [Active Participant Count Semantics](#active-participant-count-semantics). |
| `active_schemas` | Non-archived `CredentialSchema` count. | For `entity_type = CREDENTIAL_SCHEMA`: `1` if the schema is currently active, else `0`. |
| `archived_schemas` | Archived `CredentialSchema` count. | For `entity_type = CREDENTIAL_SCHEMA`: `1` if archived, else `0`. |
| `weight` | Sum of Participant trust-deposit weights (int64). | |
| `issued` | Total credentials issued. | |
| `verified` | Total credentials verified. | |
| `ecosystem_slash_events` | Ecosystem-scope slash event count. | |
| `ecosystem_slashed_amount` | Sum of ecosystem-scope slashed amounts. | |
| `ecosystem_slashed_amount_repaid` | Sum of ecosystem-scope slashed amounts that were later repaid. | |
| `network_slash_events` | Network-scope slash event count. | |
| `network_slashed_amount` | Sum of network-scope slashed amounts. | |
| `network_slashed_amount_repaid` | Sum of network-scope slashed amounts that were later repaid. | |

For each metric `m`:

- `cumulative_m` — running total of `m` **since the origin** (the earliest indexed block in scope of the row's `entity_type` / `entity_id`).
- `delta_m` — change in `cumulative_m` **since the close of the previous existing bucket of the same `(granularity, entity_type, entity_id)`**, i.e. the intra-bucket change. For the first-ever bucket of a key, `delta_m` equals `cumulative_m`.

###### Persistence rules

1. A `stats` row is created **iff at least one event in scope occurred inside the bucket interval** `[timestamp, timestamp + granularity)`. Inactive intervals MUST NOT produce a row.
2. Every metric column on every created row is `NOT NULL`. If a particular metric was unaffected during the bucket but the row was created because some other metric was affected, the unaffected metric's `delta_m` is `0` and its `cumulative_m` is carried forward from the latest prior bucket of the same `(granularity, entity_type, entity_id)`.
3. **Sparse buckets** — for a `(granularity, entity_type, entity_id)` and a timestamp with no row, the cumulative value at that timestamp is the value of the latest existing row whose `timestamp ≤ requested`. Callers traversing a range MUST forward-fill cumulatives across gaps.
4. The three granularities are populated **independently**: every in-scope event at block `H` updates the matching `HOUR`, `DAY`, and `MONTH` bucket of every entity affected, in the same indexing transaction.

###### Aggregation in the database engine

When [`IDX-STATS-QRY-2 Get Stats Range`](#idx-stats-qry-2-get-stats-range) returns a `total: StatsTotal`, the summed `delta_*` fields are computed by the database engine (`SUM(delta_*)`) in a single query — never accumulated by the application layer — to guarantee constant-time read performance on long ranges.

> Note: [`IDX-STATS-QRY-3 Count Participants`](#idx-stats-qry-3-count-participants) is **not** served by the `stats` table. It reads from the `entity_participant_changes` block-keyed log described in [Active Participant Count Semantics](#active-participant-count-semantics), because it answers point-in-time block-height queries rather than time-bucketed range queries.

##### IDX-STATS-QRY-1 Get Stats

`GET /v4/stats/get`

Retrieve a single statistics row — either by its primary key `id`, or by the natural composite key (`granularity`, `timestamp`, `entity_type`, `entity_id`). *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | query | uint64 | no¹ | Primary-key lookup |
| `granularity` | query | enum | no¹ | `HOUR` \| `DAY` \| `MONTH` |
| `timestamp` | query | datetime | no¹ | Bucket start (ISO 8601 UTC) |
| `entity_type` | query | enum | no¹ | `GLOBAL` \| `ECOSYSTEM` \| `CREDENTIAL_SCHEMA` \| `PARTICIPANT` |
| `entity_id` | query | uint64 | no¹ | Required for non-`GLOBAL` entity types |

¹ Either `id` MUST be provided, **or** the composite key (`granularity`, `timestamp`, `entity_type`, `entity_id`) MUST be provided.

**Response:** A `StatsEntry` — `id`, `granularity`, `timestamp`, `entity_type`, `entity_id`, the full set of `cumulative_*` running totals (`cumulative_participants`, `cumulative_active_schemas`, `cumulative_archived_schemas`, `cumulative_weight`, `cumulative_issued`, `cumulative_verified`, and the ecosystem/network slash counters and amounts), and the corresponding `delta_*` change-since-previous-measurement fields.

##### IDX-STATS-QRY-2 Get Stats Range

`GET /v4/stats/stats`

Retrieve cumulative-and-delta statistics over a time range as buckets, totals, or both. When `granularity` is omitted, the indexer auto-selects the smallest combination of `MONTH` + `DAY` + `HOUR` buckets that covers the range. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `timestamp_from` | query | datetime | yes | Range start (inclusive), ISO 8601 UTC |
| `timestamp_until` | query | datetime | yes | Range end (exclusive), ISO 8601 UTC |
| `entity_type` | query | enum | yes | `GLOBAL` \| `ECOSYSTEM` \| `CREDENTIAL_SCHEMA` \| `PARTICIPANT` |
| `entity_ids` | query | string | conditional | Comma-separated entity IDs (e.g. `1,2,3`). MUST be empty for `GLOBAL`, REQUIRED otherwise |
| `granularity` | query | enum | no | `HOUR` \| `DAY` \| `MONTH`. When omitted, auto-selected |
| `result_type` | query | enum | no | `BUCKETS` \| `TOTAL` \| `BUCKETS_AND_TOTAL` (default `BUCKETS_AND_TOTAL`) |

**Response:** `StatsResponse` — `granularity` (the effective granularity used), `timestamp_from`, `timestamp_until`, `entity_type`, `entity_ids`, `result_type`, plus `buckets[]: StatsBucket[]` when `result_type` includes buckets and `total: StatsTotal` when it includes a total. Each `StatsBucket` carries the same `cumulative_*` and `delta_*` fields as [`getStats`](#idx-stats-qry-1-get-stats); each `StatsTotal` carries only the summed `delta_*` fields.

##### IDX-STATS-QRY-3 Count Participants

`GET /v4/stats/count-participants`

Return the count of participants of a given role for a given entity at the block selected by the `At-Block-Height` header (or the latest indexed block when omitted), derived from the `entity_participant_changes` log. See [Conventions → Active Participant Count Semantics](#active-participant-count-semantics) for the underlying algorithm. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `entity_kind` | query | integer | yes | `0`=GLOBAL, `1`=ECOSYSTEM, `2`=CREDENTIAL_SCHEMA, `3`=PARTICIPANT |
| `entity_id` | query | uint64 | conditional | Required for non-`GLOBAL` entity kinds; MUST be omitted for `GLOBAL` |
| `role_type` | query | integer | yes | `0`=ANY, `1`=ECOSYSTEM, `2`=ISSUER_GRANTOR, `3`=ISSUER, `4`=VERIFIER_GRANTOR, `5`=VERIFIER, `6`=HOLDER |

**Response:** Inline object `{ entity_kind, entity_id, role_type, block_height, participants }` where `block_height` echoes the resolved evaluation block and `participants` is the integer count.

#### Indexer methods

##### IDX-INDEXER-QRY-1 Get Block Height

`GET /v4/indexer/block-height`

Return the latest block height that the indexer has fully processed and committed. *Indexer-specific (no VPR equivalent).*

(No parameters.)

**Response:** `{ type: "block-indexed", height: integer, timestamp: ISO-8601 datetime }`. `timestamp` is the wall-clock time at which the checkpoint was last updated (without milliseconds).

##### IDX-INDEXER-QRY-2 Get Indexer Status

`GET /v4/indexer/status`

Return the indexer's operational status — whether it is running, whether crawling is active, and any error information if crawling or the indexer has stopped. Useful for monitoring and debugging. *Indexer-specific (no VPR equivalent).*

(No parameters.)

**Response:** Inline object with `is_running` (boolean — if false, all API endpoints respond with HTTP 503), `is_crawling` (boolean — if false, APIs remain available but no new data is being indexed), and, when applicable, `stopped_at`, `stopped_reason`, `last_error: { message, stack, timestamp, service }`. The response also surfaces `X-Crawling-Status`, `X-Indexer-Status`, `X-Crawling-Reason`, `X-Crawling-Error`, and `X-Crawling-Stopped-At` HTTP response headers for consumers that prefer header-only health checks.

##### IDX-INDEXER-QRY-3 Get Version

`GET /v4/indexer/version`

Return the indexer version and the network environment it is bound to. *Indexer-specific (no VPR equivalent).*

(No parameters.)

**Response:** Inline object `{ app_version, environment: { network: { chain_id, rpc_endpoint, lcd_endpoint, cosmos_sdk_version, node_version, app_name } } }`.

##### IDX-INDEXER-QRY-4 Get Indexer Snapshot

`GET /v4/indexer/snapshot`

Return the indexed snapshot of all DID-linked objects (Ecosystems, Credential Schemas, Participants) for a single DID at the block selected by the `At-Block-Height` header (or the latest indexed block when omitted). Only queries current tables that expose a height column. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `did` | query | string | yes | DID to snapshot |

**Response:** Inline `{ did, block_height, ecosystems: object[], schemas: object[], participants: object[], count: { ecosystems, schemas, participants } }` where `block_height` echoes the resolved snapshot block.

##### IDX-INDEXER-QRY-5 List Changes

`GET /v4/indexer/changes`

Return every indexed entity change committed at the block selected by the `At-Block-Height` header (or the latest indexed block when omitted). Distinct from the WebSocket-companion [`listChanges` at `/v4/verifiable-trust/changes`](#idx-vt-qry-2-list-changes), which collapses across blocks for resolver-stream catch-up. *Indexer-specific (no VPR equivalent).*

(No method-specific parameters.)

**Response:** Inline `{ block_height, next_change_at, activity: ActivityItem[] }`. `block_height` echoes the resolved block; `next_change_at` is the next block height greater than the resolved one that has at least one indexed change (null when no later change is known). Each `activity` item has the same shape as in `ActivityTimelineResponse` (see [`getEcosystemHistory`](#idx-es-qry-4-get-ecosystem-history)).

##### IDX-INDEXER-QRY-6 List Indexer Events

`GET /v4/indexer/events`

Replay persisted indexer events scoped by the same membership filter as [`IDX-INDEXER-SUB-1`](#idx-indexer-sub-1-subscribe-indexer-events): an optional DID list, an optional Corporation, intersected when both are present. *Indexer-specific (no VPR equivalent).*

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dids` | query | string | no | Comma-separated DIDs. When present, restricts the response to events matching the DID branch of the membership filter — resources whose primary DID is in the list (`Corporation.did`, `Ecosystem.did`, or `Participant.did`, with sub-entities surfaced under their parent's DID), plus Participants whose validator's DID is in the list (one hop via `validator_participant_id`). |
| `corporation_id` | query | uint64 | no | When present, restricts the response to events matching the Corporation branch of the membership filter — the `Corporation` itself, every `Ecosystem` and `Participant` with `corporation_id` equal to this value, all sub-entities transitively embedded in any of those, plus Participants whose validator's `corporation_id` equals this value (one hop via `validator_participant_id`). |
| `after_block_height` | query | integer | no | Return events with `block_height` strictly greater than this value (default 0) |
| `limit` | query | integer | no | 1..500, default 100 — maximum number of events to return |

When **both** `dids` and `corporation_id` are present, only events matching **both** filters are returned (intersection). When **both** are absent, the response is unfiltered.

**Response:** Inline `{ events: IndexerTransactionEvent[], count, after_block_height }`. Each `IndexerTransactionEvent` carries `type: "indexer-event"`, `event_type` (Cosmos action name, e.g. `StartParticipantOP`), `did`, `block_height`, `tx_hash`, `timestamp`, and `payload: { module, action, message_type, tx_index, message_index, sender, related_dids[], entity_type, entity_id }`.

##### IDX-INDEXER-SUB-1 Subscribe Indexer Events

`WS /v4/indexer/subscribe`

Real-time push of Corporation, Governance Framework, Ecosystem, Credential Schema, Participant, Trust Deposit, Delegation, Digest, and Group events for one or more DIDs. The subscriber opens a WebSocket connection to `/v4/indexer/subscribe` and sends one or more JSON control messages; the first control message MUST be a `subscribe`. *Indexer-specific (no VPR equivalent).*

> **Routing model.** Events are routed to scoped subscriptions by DID / Corporation affiliation (`Corporation.did`, `Ecosystem.did`, `Participant.did`, or ownership via `corporation_id` — see the `subscribe` filters below). Entities with neither affiliation — Exchange Rate entries, which are global market data — are therefore not part of any scoped subscription and define no dedicated notification event types; rates are pull-data, queried on demand via the [Exchange Rate methods](#exchange-rate-methods). A **wildcard** subscription (both filters absent) still receives every indexed transaction event, Exchange Rate messages included, since `event_type` is simply the Cosmos action name of the executed message.
>
> **`x/group` events** are in scope when they target a **Corporation-anchored group**: an `x/group` message whose group or group policy anchors a Corporation (via `policy_address`, per the [Group methods](#group-methods) scope) is routed as an event **of that Corporation** — delivered to `corporationId`-scoped subscriptions for that Corporation and to `dids[]`-scoped subscriptions containing the Corporation's `did`, with `event_type` the Cosmos action name (`SubmitProposal`, `Vote`, `Exec`, `WithdrawProposal`, `UpdateGroupMembers`, `UpdateGroupPolicyDecisionPolicy`, `UpdateGroupPolicyMetadata`, `UpdateGroupMetadata`, …) and `payload.module = "group"`. This gives corporation-scoped subscribers real-time proposal-lifecycle notifications (new proposal to vote on, vote cast, proposal executed, membership changed) without polling; the corresponding read state is served by the [Group methods](#group-methods). `x/group` events targeting groups that anchor no Corporation are not routed to any scoped subscription (wildcard subscriptions still receive them).

###### Connect / ready

Immediately after a successful WebSocket upgrade, before any `subscribe` is processed, the server sends a `ready` message:

```json
{
   "type": "ready",
   "block": 1500005,
   "blockTime": "2026-05-11T13:00:05Z",
   "blockIntervalMs": 5000
}
```

- `block` — The height of the next block the indexer will process (`latestProcessedBlock + 1` at connect time), sent for information. The delivery guarantee for this connection starts at `subscribed.block` — see the `subscribed` acknowledgement below.
- `blockIntervalMs` — The expected block production interval in milliseconds. Clients SHOULD treat `2 × blockIntervalMs` as the liveness timeout: if no `subscribed` acknowledgement arrives within that window after sending a `subscribe`, the subscription was not established and the client SHOULD reconnect. The same timeout applies to ongoing heartbeat detection (see [Heartbeat (indexer events)](#heartbeat-indexer-events) below).

###### Subscribe control message

```json
{
   "action":        "subscribe",
   "dids": [
      "did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone"
   ],
   "corporationId": 42
}
```

- `dids[]` — Optional list of DIDs. When present, the server delivers events for any resource whose primary DID is in `dids[]` (i.e. `Corporation.did`, `Ecosystem.did`, or `Participant.did`, with sub-entities surfaced under their parent's DID), **and** for any `Participant` `P` whose `validator_participant_id` resolves to a `Participant` `V` such that `V.did` is in `dids[]` (one-hop validator-tree match).
- `corporationId` — Optional `uint64` (the stable `Corporation.id`). When present, the server delivers events for any resource owned by that Corporation — the `Corporation` itself, every `Ecosystem` and `Participant` with `corporation_id` equal to that value, and all sub-entities transitively embedded in any of those — **and** for any `Participant` `P` whose `validator_participant_id` resolves to a `Participant` `V` such that `V.corporation_id` equals that value (one-hop validator-tree match).
- When **both** `dids[]` and `corporationId` are present, the active set is their **intersection**: the server delivers only events that match **both** filters. When **both** are absent, the server delivers every event indexed by this indexer (wildcard).

A subsequent `subscribe` message replaces the active subscription on the same connection. To stop receiving notifications entirely, send `{ "action": "unsubscribe" }` or close the socket.

###### Subscribed acknowledgement (server → client)

The server confirms every processed `subscribe` with a `subscribed` message, sent once the subscription filter is active:

```json
{
   "type": "subscribed",
   "block": 1500007,
   "blockTime": "2026-05-11T13:00:12Z"
}
```

- `block` — The height of the next block this subscription will deliver (`latestProcessedBlock + 1` at the moment the subscription became active).
- `blockTime` — Commit time of `block - 1`, the last block processed when the subscription became active. A client snapshotting state at `block - 1` uses this as that snapshot's timestamp. Every block message with `block >= subscribed.block` is guaranteed to be delivered on this connection. Any block processed before the acknowledgement was already visible to the REST catch-up, so a client that drains after receiving `subscribed` observes every event exactly once after deduplication.

An `unsubscribe` is not acknowledged. Clients MUST ignore server messages whose `type` they do not recognise, so this acknowledgement is backward compatible.

###### Block message (server → client)

After the first `subscribe` is acknowledged with a `subscribed` message, the server sends one **block message** per processed block, in strictly increasing order of `block`:

```json
{
   "type": "block",
   "block": 1500005,
   "blockTime": "2026-05-11T13:00:05Z",
   "events": [
      {
         "type":         "indexer-event",
         "event_type":   "StartParticipantOP",
         "did":          "did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
         "block_height": 1500005,
         "tx_hash":      "AB12...",
         "timestamp":    "2026-05-11T13:00:05Z",
         "payload":      { "module": "pp", "action": "start_participant_op", "message_type": "MsgStartParticipantOP", "tx_index": 3, "message_index": 0, "sender": "verana1...", "related_dids": [], "entity_type": "Participant", "entity_id": "..." }
      }
   ]
}
```

Semantics:

- `block` — Height of the just-processed block; equal to each `events[].block_height` in the envelope.
- `blockTime` — Wall-clock time the block was committed (ISO 8601); equal to each `events[].timestamp` in the envelope.
- `events[]` — Every indexer event from that block whose `did` matches the active subscription (or every event when the subscription is the wildcard), in `(payload.tx_index, payload.message_index)` order. Each entry is a full `IndexerTransactionEvent` (same shape as the `events[]` items returned by [`listIndexerEvents`](#idx-indexer-qry-6-list-indexer-events)). Empty when no event matches at this block — the message still acts as a heartbeat.

###### Heartbeat (indexer events)

Block messages are emitted **for every processed block**, even when `events[]` is empty. Block production is the heartbeat: a connection that does not deliver a block message within the expected block-time window is presumed broken, and the client SHOULD reconnect and catch up via [`listIndexerEvents`](#idx-indexer-qry-6-list-indexer-events).

A subscriber detects a connection-level loss by observing a gap (`block > previousBlock + 1`) in the sequence of received block messages.

###### Catch-up and resume (indexer events)

This stream does not deliver historical events on connect, and an event that lands between a REST catch-up and a later `subscribe` is never redelivered — draining history *before* connecting therefore leaves a permanent gap. To bootstrap from a known point, the client SHOULD instead: (1) connect the WebSocket, read the `ready` message, send its `subscribe`, and wait for the `subscribed` acknowledgement, buffering every incoming block message from connect without applying it (a block MAY be delivered before the acknowledgement arrives); (2) call [`listIndexerEvents`](#idx-indexer-qry-6-list-indexer-events) with `after_block_height` set to its `last_seen_block`, paginating to exhaustion; (3) apply the buffered — then live — block messages in order, discarding events already applied during catch-up (same `tx_hash` and `payload.message_index`). The WebSocket delivers every block from `subscribed.block` onwards while the catch-up covers everything up to the indexer's current block, so the union has no gap and the overlap is removed by deduplication. After a temporary disconnection, the client SHOULD repeat the same pattern using the highest `block` from a previously received block message as its new `last_seen_block`.

###### Backpressure (indexer events)

A subscriber that fails to drain its receive buffer within an indexer-defined window MAY have its connection closed with WebSocket close code `1011` (server error / overloaded). The client SHOULD reconnect and resume via [`listIndexerEvents`](#idx-indexer-qry-6-list-indexer-events).

#### Verifiable Trust Resolver methods

The Verifiable Trust Resolver answers two complementary questions about a DID at a chosen point in time:

1. **Is the DID a Verifiable Service?** — Reflected in the boolean `trusted` field of the response.

   Per [[VS-REQ]], a DID qualifies as a **Verifiable Service** only if:
   - **[VS-REQ-2]** It presents a valid Service Credential (`ECS-SERVICE` VTC).
   - **[VS-REQ-3]** If the issuer of the Service Credential **is the VS itself** (self-issued), the VS MUST also present exactly one `ECS-ORG` or `ECS-PERSONA` credential.
   - **[VS-REQ-4]** If the issuer of the Service Credential **is another DID**, the DID Document of that issuer MUST present exactly one `ECS-ORG` or `ECS-PERSONA` credential.

   This ensures every VS is ultimately bound to a legally or naturally accountable entity — either directly (the VS identifies itself) or indirectly (the issuer of its Service Credential identifies itself). A DID that satisfies these requirements is returned with `trusted: true`; otherwise `trusted: false`.

2. **What contextual data does the indexer have on this DID?** — Opt-in sections selected via the request payload. Each section is suppressed by default and is only computed and returned when its selector is set:

   - **`corporation`** — The on-chain Corporation entry the DID **represents** (the Corporation whose `did` equals the resolved DID). A singular object — by VPR, a DID is the `did` of at most one Corporation; omitted when no such Corporation exists for this `did`. Carries the Corporation's stable `id` (uint64) and `policy_address` (the on-chain account that signs on its behalf), plus `deposit`, slash history, and active CGF.
   - **`participations`** — Credential Schemas the DID participates in, filterable by state (`ACTIVE`, `FUTURE`, `INACTIVE`, `EXPIRED`, `REVOKED`, `SLASHED`, `REPAID`); defaults to `ACTIVE` when no filter is given.
   - **`ecsCredentials`** — The full ECS credentials extracted from the DID's linked-VPs, with their `credentialSubject` claims. Each entry carries the credential `id` (required — a VC-mandatory attribute), plus two informational fields the evaluation computes anyway per [[IDX-VT-EVAL-1]]: `digestJCS` (the recomputed, ledger-verified JCS digest) and `issuedAtTime` (the `created` timestamp of the credential's ledger `Digest` entry — its effective issuance time). Two entries with the same `digestJCS` in one response MUST NOT occur: the indexer MUST exclude such duplicates.
   - **`services`** — Non-`LinkedVerifiablePresentation` service entries from the DID Document (DIDComm, MCP, A2A, VsAgentAdminAPI, …), surfaced verbatim.
   - **`presentations`** — Per-VP credential summaries (`vtcCredentials[]`, each entry `{id, credentialSchemaId, ecosystemId}`); sub-flags additionally surface unresolvable and invalid credential IDs per VP.
   - **`ecosystems`** — Aggregate metrics for the Ecosystems (and their underlying Credential Schemas and active Ecosystem Governance Frameworks) **the DID is the controller of** (the Ecosystems whose `did` equals the resolved DID). Sub-flags control whether archived Ecosystems (and their archived embedded Credential Schemas) are included.

The response always carries the core fields (`did`, `trusted`, `evaluatedAtTime`, `evaluatedAtBlock`, `expiresAtTime`, `corporationId`); every other section is gated by its selector. The `vsOperator` account, in contrast, is surfaced **per Participant** (not at envelope level) because each `Participant` entry carries its own VS Operator Authorization grant from its controlling Corporation (`Participant.corporation_id`). The full payload contract is normatively defined by the [Resolution request schema](#resolution-request-schema) and [Resolution response schema](#resolution-response-schema) below.

`corporationId` is the resolved DID's **owner Corporation** per the VPR [DID ownership invariant](https://verana-labs.github.io/verifiable-trust-vpr-spec/versions/v4/#did-ownership-invariant): the Corporation whose own `did` equals the resolved DID or, when none exists, the single Corporation owning the `Participant` / `Ecosystem` entries claiming it — the invariant guarantees all sources agree. Every indexed DID is claimed by at least one entity, so `corporationId` is total and MUST NOT be null (implementations emitting `null` for e.g. Ecosystem DIDs MUST switch to owner derivation). The `corporation` *object*, in contrast, is included only when the resolved DID is the Corporation's own declared `did`. `participations[]` entries do not repeat `corporation_id`: it always equals the envelope `corporationId`.

The point-in-time is controlled by the `At-Block-Height` HTTP request header per [Conventions](#at-block-height-header); when omitted, the resolver evaluates against the latest indexed block. The resolved block is echoed back as `evaluatedAtBlock` (with `evaluatedAtTime` as its wall-clock equivalent) in the response.

> **Recursive resolution.** To obtain full details about any other DID surfaced in the response (e.g. an ECS credential's subject at `ecsCredentials[].credentialSubject.id`, or any other DID a consumer chooses to inspect), call this same method on that DID. Note that most cross-entity references are surfaced by stable VPR id rather than DID (e.g. `corporationId`, `ecosystemId`, `credentialSchemaId`, `participantId`, `issuerParticipantId`) and do not need re-resolution — they're already directly joinable.

##### Trust Evaluation Lifecycle

This subsection normatively defines **what** the trust evaluation depends on, **when** it is recomputed, and **how** `expiresAtTime` is derived. It exists because the entire downstream trust surface (including the [Verana Graph](../verana-graph/spec.md) query-time gates of [[TG-ACT-3]](../verana-graph/spec.md#visibility-and-retention-model) / [[TG-FCT-2]](../verana-graph/spec.md#faceted-search-queries)) treats `expiresAtTime` as an *exact* horizon: crossing it means the DID is genuinely no longer trustable, not merely that cached data went stale.

[IDX-VT-EVAL-1] **Evaluation inputs.** The `trusted` verdict per [VS-REQ] is derived **exclusively** from:

- the DID's presented **ECS-SERVICE** credential and the `Participant` entries anchoring it;
- the **ECS-ORG** or **ECS-PERSONA** credential of the **anchor service** — the DID itself when the Service Credential is self-issued (architecture pattern #1, [VS-REQ-3]), or the issuing parent service when it is issued by another DID (architecture pattern #2, [VS-REQ-4]) — and the `Participant` entry anchoring that credential;
- a **point-in-time issuance check**: at the issuance instant of the ECS-ORG / ECS-PERSONA credential, its issuer held a valid `Participant` entry granting the right to issue it. This is verified once per evaluation against historical indexed state; it is *not* a future boundary — subsequent expiry of the issuer's `Participant` entry does not invalidate an already-issued credential (revocation and slashing do, and those are signalled on-chain).

The **issuance instant is determined objectively from the credential's VPR-anchored digest** — never from issuer-asserted fields (`validFrom` proves nothing about when a credential was actually issued and can be backdated).

How a credential's `digestJCS` is computed, how its `digest_algorithm` is resolved, and how the effective issuance time is obtained from the VPR are normatively defined by [W3C VTCs: Determining Credential Issuance Time](https://verana-labs.github.io/verifiable-trust-spec/versions/v4/#w3c-vtcs-determining-credential-issuance-time). This document does not restate that procedure, and an implementation MUST NOT vary it.

For each ECS-ORG / ECS-PERSONA credential named above, the evaluation MUST obtain the effective issuance time per that section, then **verify the issuer's authorization at that instant**. The issuer's grant window is evaluated at the effective issuance time; the issuer's `participant_state` is evaluated at the evaluated block.

The digest lookup is performed against ledger state at the evaluated block, per [Conventions → `At-Block-Height` header](#at-block-height-header), and its result yields the effective issuance time. A credential with no corresponding `Digest` entry at that block has no provable issuance time, and the DID MUST NOT be `trusted` through it.

The recomputed digest and the effective issuance time are surfaced informationally on each `ecsCredentials[]` entry as `digestJCS` and `issuedAtTime`.

Other presented credentials (non-ECS VTCs, ECS-UA, ECS-BADGE, additional VP contents) are contextual data surfaced by the opt-in response sections; they MUST NOT influence `trusted` or `expiresAtTime`.

[IDX-VT-EVAL-2] **`expiresAtTime` computation.** `expiresAtTime` MUST be computed as the **minimum** of the following future boundaries, evaluated over the inputs of [[IDX-VT-EVAL-1]]:

- `effective_until` (when non-null) of the `Participant` entries anchoring the DID's ECS-SERVICE credential;
- `validUntil` (when present) of the DID's ECS-SERVICE credential;
- `effective_until` (when non-null) of the `Participant` entry anchoring the anchor service's ECS-ORG / ECS-PERSONA credential, and `validUntil` (when present) of that credential.

When the boundary set is empty (all relevant `effective_until` are null and no relevant credential carries `validUntil`), `expiresAtTime` MUST be `null`: the evaluation has no known future boundary and remains valid until a re-evaluation event per [[IDX-VT-EVAL-3]].

`expiresAtTime` is therefore a deterministic function of indexed state at the evaluated block — **not** of the wall-clock time at which a resolve request happens to be served. An implementation MUST NOT substitute a fixed re-check TTL (e.g. `evaluatedAtTime + 1h`): a synthetic TTL manufactures expirations for DIDs whose trust state is provably unchanged, needlessly evicting them from downstream trust surfaces, and at scale (millions of services) would force mass periodic recomputation that this event-driven design exists to avoid.

[IDX-VT-EVAL-3] **Re-evaluation triggers.** The indexer MUST re-evaluate the trust state of a DID (and recompute its `expiresAtTime`) when, and only when:

1. a state-affecting VPR message touches any input of [[IDX-VT-EVAL-1]] for that DID (`Participant` lifecycle messages, revocation, slashing, repayment, `SetParticipantEffectiveUntil`, `SetParticipantOPtoValidated`, …);
2. a **`TriggerResolver`** event ([VPR MOD-PP-MSG-15](https://verana-labs.github.io/verifiable-trust-vpr-spec/#mod-pp-msg-15-trigger-resolver)) is emitted for a `Participant` entry whose `did` is the DID: the indexer MUST consume this event, re-fetch the DID's off-chain material (DID Document, linked VPs, presented credentials), and re-evaluate. `TriggerResolver` is the **sole** signal for off-chain changes (linked-VP updates, off-chain revocations, a credential entering validity after a future `validFrom`); emitting it is the responsibility of the service / holder side, and the indexer MUST NOT compensate for a missing signal with polling, TTLs, or periodic recomputation — trust-surface staleness caused by an unsignalled off-chain change is attributable to the service that failed to signal it;
3. the cascade of [[IDX-VT-EVAL-4]] reaches the DID.

Time-driven `Participant` state transitions (`effective_from` / `effective_until` crossing block time) are materialised by the [per-block tick](#per-block-tick-time-driven-every-block) and already fire `participations` change envelopes; they require no additional scheduling here. A **passive crossing of `expiresAtTime` itself requires no indexer action**: by construction of [[IDX-VT-EVAL-2]] the crossing coincides with a genuine loss of trustability, and downstream consumers enforce it with query-time gates against the persisted value.

[IDX-VT-EVAL-4] **Dependency cascade.** After re-evaluating a DID `Y`, the indexer MUST re-evaluate every indexed service whose ECS-SERVICE credential has issuer `Y` (the pattern-#2 child services anchored on `Y`), and emit change envelopes (per the [`trust` channel](#websocket-channels)) for every DID whose trust-core fields changed as a result. No dedicated reverse index is required beyond the ability to query indexed services by ECS-SERVICE credential issuer.

[IDX-VT-EVAL-5] **Persisted trust-core.** The indexer MUST persist the trust-core fields (`trusted`, `evaluatedAtTime`, `evaluatedAtBlock`, `expiresAtTime`, `corporationId`) per DID. This is what makes the [`trust` channel](#websocket-channels)'s "changed" predicate decidable and keeps `expiresAtTime` stable across resolve calls between re-evaluation events. Resolve requests serve the persisted evaluation (re-projected at the requested `At-Block-Height` where applicable); they MUST NOT recompute `expiresAtTime` relative to request time.

##### IDX-VT-QRY-1 Resolve

`POST /v4/verifiable-trust/resolve`

###### Resolution request schema

The normative JSON Schema for the resolution request is published alongside this document at [`schemas/v4/vt/request.schema.json`](./schemas/v4/vt/request.schema.json). It defines the `did` parameter and the response-shaping selectors (`corporation`, `participations`, `ecsCredentials`, `services`, `presentations`, `ecosystems`). The point-in-time is selected via the `At-Block-Height` HTTP header and is therefore not part of the request body.

###### Resolution response schema

The normative JSON Schema for the resolution response is published alongside this document at [`schemas/v4/vt/response.schema.json`](./schemas/v4/vt/response.schema.json). It defines the always-present core fields (`did`, `trusted`, `evaluatedAtTime`, `evaluatedAtBlock`, `expiresAtTime`, `corporationId`) and every optional section returned when the corresponding request selector is set.

###### Example resolution request

The following is a **maximum** request that asks for every optional section the resolver can return. Any top-level selector below MAY be omitted, in which case that section is excluded from the response. The response always includes the core fields (`did`, `trusted`, `evaluatedAtTime`, `evaluatedAtBlock`, `expiresAtTime`, `corporationId`).

```json
{
   "did": "did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
   "corporation": true,
   "participations": {
      "states": ["ACTIVE", "FUTURE", "INACTIVE", "EXPIRED", "REVOKED", "SLASHED", "REPAID"]
   },
   "ecsCredentials": true,
   "services": true,
   "presentations": {
      "unresolvableCredentialIds": true,
      "invalidCredentialIds": true
   },
   "ecosystems": {
      "includeArchived": true,
      "credentialSchemas": {
         "includeArchived": true
      }
   }
}
```

Point-in-time is selected via the `At-Block-Height` HTTP request header (see [Conventions](#at-block-height-header)); it is not part of the JSON body. To target the historical block from the example above (`1500000`), send `At-Block-Height: 1500000` alongside the POST.

Selector semantics:

- **`corporation`** — `true` to include the `corporation` object (the unique Corporation whose `did` equals the resolved DID; carries `id`, `policyAddress`, `deposit`, slash history, and `cgf`). Omit or set `false` to exclude. The top-level `corporationId` scalar — the stable `uint64` id of the Corporation that *owns* this DID, i.e. the unique Corporation entry whose `did` equals the resolved DID — is **always** returned with the trust-core fields and is not gated by this selector. Its value is well-defined by VPR's per-Corporation `did` uniqueness invariant (at most one Corporation has any given DID); see the `Ecosystem.corporationId` description in [`schemas/v4/vt/response.schema.json`](./schemas/v4/vt/response.schema.json) for the caveat that the Corp that *owns* a DID and the Corp that *controls Ecosystems claiming* that DID are not unified by any VPR invariant. When the `corporation` selector is also set, `corporation.id` equals this scalar; the selector only controls whether the full Corporation object (`policyAddress`, `deposit`, slash history, CGF) is also surfaced inline.
- **`participations`** — Omit to exclude. When present, `states[]` filters which participation states are returned. Defaults to `["ACTIVE"]` when `participations` is provided without `states`. Valid values: `ACTIVE, FUTURE, INACTIVE, EXPIRED, REVOKED, SLASHED, REPAID`.
- **`ecsCredentials`** — `true` to include the full ECS credentials with subject claims. Omit or `false` to exclude.
- **`services`** — `true` to include `services[]`, the non-LinkedVerifiablePresentation service entries from the DID Document (e.g. DIDComm, MCP, VsAgentAdminAPI). Omit or `false` to exclude.
- **`presentations`** — Omit to exclude. When present, each entry always carries `vtcCredentials[]` (array of `{id, credentialSchemaId, ecosystemId}` per non-ECS VTC carried by the VP) plus the VP's `id` and `serviceId`. The two sub-flags additionally enable `unresolvableCredentialIds[]` and `invalidCredentialIds[]` per entry; both default to `false`.
- **`ecosystems`** — Omit to exclude. `includeArchived` (default `false`) controls whether archived ecosystems appear in the top-level array. The nested `credentialSchemas` object controls embedded Credential Schemas: omit `credentialSchemas` entirely to suppress them, or set `credentialSchemas.includeArchived` (default `false`) to also surface archived Credential Schemas.

###### Example resolution response

participation states: REPAID, SLASHED, REVOKED, EXPIRED, ACTIVE, FUTURE, INACTIVE
participation roles: HOLDER, ISSUER, VERIFIER, ISSUER_GRANTOR, VERIFIER_GRANTOR, ECOSYSTEM
validatorParticipantId: non-null `uint64` pointer to the parent `Participant` in the permission tree for every role except `ECOSYSTEM`; explicitly `null` only when `role = ECOSYSTEM` (the chain root). This example resolves an organization DID, so every surfaced Participant is non-ECOSYSTEM — the `null` case is visible only when resolving a trust-registry-controller DID.

expiresAtTime: derived per [[IDX-VT-EVAL-2]] — here the earliest boundary is the `effective_until` (`2027-01-31T23:59:59.000Z`) of the `Participant` entry anchoring the ECS-SERVICE credential, which precedes the credential's own `validUntil` (`2030-01-01T19:23:24Z`). It is **not** a TTL relative to `evaluatedAtTime`, and it would be `null` if no boundary existed.

```json
{
   "did":"did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
   "trusted":true,
   "evaluatedAtTime":"2026-05-06T17:00:00.000Z",
   "evaluatedAtBlock":1500000,
   "expiresAtTime":"2027-01-31T23:59:59.000Z",
   "corporationId":42,
   "corporation":{
      "id":42,
      "policyAddress":"verana1rw7w9hm0zd7e4jcxsm955nu8l5ju0wtkpssxe5",
      "deposit":"40000000uvna",
      "lastSlashedAtTime":"2026-01-01T03:00:00.000Z",
      "slashedEvents":1,
      "slashedValue":"1000000uvna",
      "cgf":{
         "version":3,
         "activeSince":"2026-02-15T09:00:00.000Z",
         "documents":[
            {
               "language":"en",
               "url":"https://corp.acme.example/cgf/v3/en.html",
               "digestSri":"sha384-…"
            },
            {
               "language":"fr",
               "url":"https://corp.acme.example/cgf/v3/fr.html",
               "digestSri":"sha384-…"
            }
         ]
      }
   },
   "participations":[
      {
         "id":501,
         "vsOperator":"verana19kpereglz3jw690kjys3lnulx2r06p99l5u6sz",
         "role":"ISSUER",
         "state":"ACTIVE",
         "credentialSchemaId":1234,
         "ecosystemId":9876,
         "weight":"10000000uvna",
         "issuedCredentials":2345,
         "participants":{
            "HOLDER":75
         },
         "validatorParticipantId":401
      },
      {
         "id":502,
         "vsOperator":"verana19kpereglz3jw690kjys3lnulx2r06p99l5u6sz",
         "role":"VERIFIER",
         "state":"ACTIVE",
         "credentialSchemaId":5678,
         "ecosystemId":9877,
         "weight":"5000000uvna",
         "verifiedCredentials":500,
         "validatorParticipantId":402
      },
      {
         "id":503,
         "vsOperator":"verana1otheropacctxxxxxxxxxxxxxxxxxxxxxxxxx",
         "role":"ISSUER_GRANTOR",
         "state":"REPAID",
         "credentialSchemaId":9012,
         "ecosystemId":9878,
         "weight":"5000000uvna",
         "participants":{
            "ISSUER":7,
            "HOLDER":1250
         },
         "verifiedCredentials":500,
         "validatorParticipantId":403
      }
   ],
   "ecsCredentials":[
      {
         "ecsSchema":"ServiceCredential",
         "ecsSchemaVersion":"v4",
         "credentialSchemaId":11,
         "issuerParticipantId":801,
         "ecosystemId":1,
         "participantId":601,
         "id":"urn:uuid:cc5c398f-bc64-45df-9482-9cb583cce197",
         "digestJCS":"NsQMTn9itZLmRkNs574oDPojGA2Z16QzAC74xXIDrnzpuEvGvF2ReGkXycm2NNRl",
         "issuedAtTime":"2026-02-10T09:15:00Z",
         "validFrom":"2010-01-01T19:23:24Z",
         "validUntil":"2030-01-01T19:23:24Z",
         "credentialSubject":{
            "id":"did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
            "name":"Acme MCP Service",
            "type":"MCPService",
            "description":"AI tooling backend for Acme partners.",
            "minimumAgeRequired":0,
            "termsAndConditionsUri":"https://acme-vs.example.com/terms",
            "termsAndConditionsDigestSri":"sha384-…",
            "privacyPolicyUri":"https://acme-vs.example.com/privacy",
            "privacyPolicyDigestSri":"sha384-…",
            "logoUri":"https://acme-vs.example.com/logo.png",
            "logoDigestSri":"sha384-…"
         }
      },
      {
         "ecsSchema":"OrganizationCredential",
         "ecsSchemaVersion":"v4",
         "credentialSchemaId":12,
         "issuerParticipantId":802,
         "ecosystemId":1,
         "participantId":602,
         "id":"urn:uuid:8f2a1c04-77de-4b31-a5c9-0e6f4d2b9a11",
         "digestJCS":"4gXBGI8rCgbPbB0t9KPgG4vvOxKiaWaR2ARbObScE9xU6uKCJl5nFttjw2s0Ro6Z",
         "issuedAtTime":"2026-01-22T14:40:00Z",
         "validFrom":"2010-01-01T19:23:24Z",
         "validUntil":"2030-01-01T19:23:24Z",
         "credentialSubject":{
            "id":"did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
            "name":"Acme Corp",
            "registryId":"BE0123456789",
            "registryUri":"https://kbo-data.economie.fgov.be/",
            "address":"Rue de la Loi 1, 1000 Brussels",
            "countryCode":"BE",
            "legalJurisdiction":"BE",
            "lei":"529900T8BM49AURSDO55",
            "organizationKind":"PRIVATE",
            "logoUri":"https://acme-vs.example.com/logo.png",
            "logoDigestSri":"sha384-…"
         }
      }
   ],
   "presentations":[
      {
         "id":"https://organization.vs.hologram.zone/vt/vp1.json",
         "vtcCredentials":[
            {
               "id":"urn:uuid:22222222-aaaa-bbbb-cccc-222222222222",
               "credentialSchemaId":30001,
               "ecosystemId":9876,
               "participantId":701,
               "issuerParticipantId":901
            },
            {
               "id":"urn:uuid:33333333-aaaa-bbbb-cccc-333333333333",
               "credentialSchemaId":30002,
               "ecosystemId":9877,
               "participantId":702,
               "issuerParticipantId":902
            }
         ],
         "unresolvableCredentialIds":[
            "urn:uuid:44444444-aaaa-bbbb-cccc-444444444444"
         ],
         "invalidCredentialIds":[
            "urn:uuid:88888888-aaaa-bbbb-cccc-888888888888"
         ],
         "serviceId":"did:web:organization.vs.hologram.zone#vt-vp1"
      }
   ],
   "services":[
      {
         "id":"did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone#mcp",
         "type":"MCP",
         "serviceEndpoint":"https://organization.vs.hologram.zone/mcp"
      },
      {
         "id":"did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone#did-communication",
         "serviceEndpoint":"wss://organization.vs.hologram.zone/didcomm",
         "type":"did-communication",
         "accept":[
            "didcomm/aip2;env=rfc19",
            "didcomm/v2"
         ]
      }
   ],
   "ecosystems":[
      {
         "id":1234,
         "corporationId":42,
         "archived":false,
         "egf":{
            "version":7,
            "activeSince":"2026-03-01T00:00:00.000Z",
            "documents":[
               {
                  "language":"en",
                  "url":"https://ecosystem1.example/egf/v7/en.html",
                  "digestSri":"sha384-…"
               },
               {
                  "language":"es",
                  "url":"https://ecosystem1.example/egf/v7/es.html",
                  "digestSri":"sha384-…"
               }
            ]
         },
         "credentialSchemas":[
            {
               "id":223,
               "type":"JsonSchema",
               "digestSri":"sha384-…",
               "archived":false,
               "participants":{
                  "ECOSYSTEM":2000,
                  "ISSUER_GRANTOR":100,
                  "ISSUER":400,
                  "VERIFIER_GRANTOR":50,
                  "VERIFIER":45,
                  "HOLDER":1000
               },
               "issuedCredentials":14526,
               "verifiedCredentials":7256725
            }
         ],
         "participants":{
            "ECOSYSTEM":2000,
            "ISSUER_GRANTOR":100,
            "ISSUER":400,
            "VERIFIER_GRANTOR":50,
            "VERIFIER":45,
            "HOLDER":1000
         },
         "issuedCredentials":14526,
         "verifiedCredentials":7256725
      }
   ]
}
```

The Verifiable Trust Resolver also exposes a real-time event stream so that clients can keep an indexer-backed mirror in sync without polling `/v4/verifiable-trust/resolve` for every DID on every block.

The stream is organised around three coordinated endpoints. Together they cover live updates (`subscribeChanges`), catch-up after a disconnection (`listChanges`), and bootstrap from an empty mirror (`listIndexedDids`).

The unit of notification is **(DID, block)**: each time the indexer processes a new block, it re-evaluates trust for every DID whose state may have changed and emits **at most one change envelope per DID per block**, restricted to the channels the subscriber selected.

The normative JSON Schemas for this stream are published alongside this document:

- [`schemas/v4/vt/subscribe.schema.json`](./schemas/v4/vt/subscribe.schema.json) — client → server WebSocket control messages (`subscribe`, `unsubscribe`), including the channel selectors and sub-flags described in the [Websocket Channels](#websocket-channels) section below.
- [`schemas/v4/vt/changes.schema.json`](./schemas/v4/vt/changes.schema.json) — server-side payloads: the WS `ready` message, the WS `block` message, and the `listChanges` REST response, all sharing the common `ChangeEnvelope` shape.

##### Websocket Channels

A subscription selects a set of channels. Each channel narrows what counts as a "change" for the subscribed DID:

| Channel | Triggers a notification when … |
| --- | --- |
| `trust` | A **re-evaluation event** ([[IDX-VT-EVAL-3]] — state-affecting message, consumed `TriggerResolver`, or dependency cascade) changes any of the persisted trust-core fields (`trusted`, `evaluatedAtTime`, `evaluatedAtBlock`, `expiresAtTime`, `corporationId`). The new values are delivered inline. The top-level `corporationId` rotation (DID re-binding to a different Corporation, e.g. as part of an ownership transfer) is signalled here. A passive wall-clock crossing of `expiresAtTime` is **not** a change event — per [[IDX-VT-EVAL-2]] the crossing itself is the signal, enforced by consumers at query time. |
| `corporation` | The `corporation` object (the singular Corporation whose `did` equals the resolved DID) is created or removed (i.e. the DID is bound to a Corporation, or that binding ends — e.g. a `Corporation.did` rotation away from this DID); **or** experiences a slash event; **or** its active CGF rotates (`active_version` advances) or any document of the active CGF version changes (URL or `digestSri`). The top-level `corporationId` scalar itself (the binding "this DID is operated by *that* Corp") is part of the `trust` channel above and is not gated separately. `deposit` fluctuations alone are gated by the `includeDepositChanges` sub-flag below. |
| `participations` | A `Participant` entry the DID is part of is created or transitions state. `weight` fluctuations alone are gated by the `includeWeightChanges` sub-flag below. |
| `ecsCredentials` | An ECS credential issued to or by the DID is added, replaced, or invalidated. |
| `presentations` | A `LinkedVerifiablePresentation` referenced by the DID Document is added or removed, or its `vtcCredentials[]` set changes (entry added/removed, or any entry's `credentialSchemaId` / `ecosystemId` / `participantId` / `issuerParticipantId` changes). Changes confined to `unresolvableCredentialIds[]` or `invalidCredentialIds[]` are **not** notified. |
| `services` | A non-`LinkedVerifiablePresentation` service entry in the DID Document changes (DIDComm, MCP, A2A, VsAgentAdminAPI, …). |
| `ecosystems` | An `Ecosystem` entry the DID represents is created or archived; its embedded schemas change; **or** its active EGF rotates (`active_version` advances) or any document of the active EGF version changes (URL or `digestSri`). |

Channels that carry Coin-amount fields (`weight`, `deposit`) or high-frequency aggregate counters (`participants[role]`, `issuedCredentials`, `verifiedCredentials`) expose opt-in sub-flags so subscribers can choose whether routine fluctuations of those values trigger notifications:

| Channel | Sub-flag | Effect when `true` |
| --- | --- | --- |
| `corporation` | `includeDepositChanges` | Changes in the `corporation` object's `deposit` Coin amount trigger a notification (independent of slash events, which always trigger). |
| `participations` | `includeWeightChanges` | Changes in a Participant's `weight` Coin amount trigger a notification. |
| `participations` | `includeParticipantCounts` | Changes in `participants[role]` counters trigger a notification. |
| `participations` | `includeIssuedCredentials` | Changes in the `issuedCredentials` counter trigger a notification. |
| `participations` | `includeVerifiedCredentials` | Changes in the `verifiedCredentials` counter trigger a notification. |
| `ecosystems` | `includeParticipantCounts` | Changes in Ecosystem-level `participants[role]` counters trigger a notification. |
| `ecosystems` | `includeIssuedCredentials` | Changes in the Ecosystem-level `issuedCredentials` counter trigger a notification. |
| `ecosystems` | `includeVerifiedCredentials` | Changes in the Ecosystem-level `verifiedCredentials` counter trigger a notification. |

All sub-flags default to `false`. The Coin-amount flags (`includeDepositChanges`, `includeWeightChanges`) and the counter flags (`includeParticipantCounts`, `includeIssuedCredentials`, `includeVerifiedCredentials`) gate fields that can tick on routine transactions and would otherwise dominate the stream.

Channel flags carry **change signals**, not full new values — except for `trust`, which is delivered inline because it is small, fixed-shape, and the most frequently consumed. To obtain the new state for any other changed channel, the client calls `/v4/verifiable-trust/resolve` with the `At-Block-Height` header set to the block of the change envelope.

##### IDX-VT-SUB-1 Subscribe Changes

The subscriber opens a WebSocket connection to `/v4/verifiable-trust/subscribe` and sends one or more JSON control messages. The first control message MUST be a `subscribe`.

###### Connect / ready

Immediately after a successful WebSocket upgrade, before any `subscribe` is processed, the server sends a `ready` message:

```json
{
   "type": "ready",
   "block": 1500005,
   "blockTime": "2026-05-11T13:00:05Z",
   "blockIntervalMs": 5000
}
```

- `block` — The height of the next block the indexer will process (`latestProcessedBlock + 1` at connect time), sent for information. The bootstrap snapshot point is `subscribed.block - 1` — see [Bootstrap pattern](#bootstrap-pattern).
- `blockIntervalMs` — The expected block production interval in milliseconds. Clients SHOULD treat `2 × blockIntervalMs` as the liveness timeout: if no `subscribed` acknowledgement arrives within that window after sending a `subscribe`, the subscription was not established and the client SHOULD reconnect. The same timeout applies to ongoing heartbeat detection (see [Heartbeat (resolver changes)](#heartbeat-resolver-changes)).

###### Subscribe control message

```json
{
   "action":        "subscribe",
   "dids": [
      "did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone"
   ],
   "corporationId": 42,
   "channels": {
      "trust":          true,
      "ecsCredentials": true,
      "presentations":  true,
      "services":       true,
      "corporation": {
         "includeDepositChanges":            false
      },
      "participations": {
         "includeWeightChanges":       false,
         "includeParticipantCounts":   false,
         "includeIssuedCredentials":   false,
         "includeVerifiedCredentials": false
      },
      "ecosystems": {
         "includeParticipantCounts":   false,
         "includeIssuedCredentials":   false,
         "includeVerifiedCredentials": false
      }
   }
}
```

- `dids[]` — Optional list of DIDs. When present, the resolver delivers change envelopes for any DID in `dids[]` and for any `Participant` whose `validator_participant_id` resolves to a `Participant` `V` such that `V.did` is in `dids[]` (one-hop validator-tree match).
- `corporationId` — Optional `uint64` (the stable `Corporation.id`). When present, the resolver delivers change envelopes for the Corporation's own DID, for every `Ecosystem` and `Participant` DID with `corporation_id` equal to that value, and for any `Participant` whose `validator_participant_id` resolves to a `Participant` `V` such that `V.corporation_id` equals that value (one-hop validator-tree match).
- When **both** `dids[]` and `corporationId` are present, the active DID set is their **intersection**. When **both** are absent, the resolver subscribes to every indexed DID (wildcard).
- `channels` — Map from channel name to either a boolean (use defaults) or a sub-options object. Channels not listed in the map are excluded from the stream.

A subsequent `subscribe` message replaces the active subscription on the same connection. To stop receiving notifications entirely, send `{ "action": "unsubscribe" }` or close the socket.

###### Subscribed acknowledgement (server → client)

The server confirms every processed `subscribe` with a `subscribed` message, sent once the subscription filter is active:

```json
{
   "type": "subscribed",
   "block": 1500007,
   "blockTime": "2026-05-11T13:00:12Z"
}
```

- `block` — The height of the next block this subscription will deliver (`latestProcessedBlock + 1` at the moment the subscription became active).
- `blockTime` — Commit time of `block - 1`, the last block processed when the subscription became active. A client snapshotting state at `block - 1` uses this as that snapshot's timestamp. Every block message with `block >= subscribed.block` is guaranteed to be delivered on this connection. Any block processed before the acknowledgement was already visible to `listChanges`, so a client that drains after receiving `subscribed` observes every event exactly once after deduplication.

An `unsubscribe` is not acknowledged. Clients MUST ignore server messages whose `type` they do not recognise, so this acknowledgement is backward compatible.

###### Block message (server → client)

After the first `subscribe` is acknowledged with a `subscribed` message, the server sends one **block message** per processed block, in strictly increasing order of `block`:

```json
{
   "type": "block",
   "block": 1500005,
   "blockTime": "2026-05-11T13:00:05Z",
   "changes": [
      {
         "did": "did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
         "trust": {
            "trusted":          true,
            "evaluatedAtTime":  "2026-05-11T13:00:05Z",
            "evaluatedAtBlock": 1500005,
            "expiresAtTime":    "2027-01-31T23:59:59.000Z",
            "corporationId":    42
         },
         "corporation":    true,
         "participations": true,
         "ecsCredentials": true,
         "presentations":  false,
         "services":       false,
         "ecosystems":     true
      }
   ]
}
```

Semantics:

- `block` — Height of the just-processed block.
- `blockTime` — Wall-clock time the block was committed (ISO 8601).
- `changes[]` — One entry per DID whose subscribed-to state changed at this block. Empty when no subscribed change occurred — the message still acts as a heartbeat.
- `changes[].did` — The DID this envelope refers to.
- `changes[].trust` — Present iff `trust` is in the subscription **and** any trust-core field changed at this block. Carries the new core values inline, with the same shape as the trust-core fields in the [resolution response schema](#resolution-response-schema).
- `changes[].<channel>` — `true` iff the channel is in the subscription **and** changed at this block; `false` otherwise. Clients fetch the new state by calling `/v4/verifiable-trust/resolve` with `At-Block-Height: <block>`.

> **Why signal-only?** All channels except `trust` carry change signals (`true`/`false`) rather than inline payloads. This is by design:
>
> - **`trust` is the exception** — it is small, fixed-shape, and the most frequently consumed channel. Clients that subscribe only to `trust` receive everything they need inline and never have to call `/v4/verifiable-trust/resolve`.
> - **Other channels have variable, potentially large payloads** — a DID may have hundreds of participations or ecosystem entries. Inlining them in every WebSocket frame would bloat the stream even for clients that only need a narrow slice of the data.
> - **Resolve gives response-shaping control** — the `/v4/verifiable-trust/resolve` call lets the client select exactly which sections and sub-flags it needs; a fat WebSocket payload cannot offer that flexibility.
> - **Server fan-out stays cheap** — computing and serialising full per-subscriber per-DID payloads on every block would multiply the indexer's CPU and memory cost by the number of concurrent subscribers.
>
> In practice, most blocks produce zero or very few changes for a given subscriber's DID set, so the number of follow-up resolve calls per block is low. Clients that need state for multiple DIDs that changed in the same block can batch their resolve calls.

###### Heartbeat (resolver changes)

Block messages are emitted **for every processed block**, even when `changes[]` is empty. Block production is the heartbeat: a connection that does not deliver a block message within the expected block-time window is presumed broken, and the client SHOULD reconnect and catch up via [`listChanges`](#idx-vt-qry-2-list-changes).

A subscriber detects a connection-level loss by observing a gap (`block > previousBlock + 1`) in the sequence of received block messages.

###### Backpressure (resolver changes)

A subscriber that fails to drain its receive buffer within an indexer-defined window MAY have its connection closed with WebSocket close code `1011` (server error / overloaded). The client SHOULD reconnect and resume via `listChanges`.

##### IDX-VT-QRY-2 List Changes

After a disconnection — or whenever the subscriber detects a gap in the WebSocket sequence — `listChanges` returns the same change envelopes as the WebSocket but compressed: it skips blocks with no subscribed changes, so the client never has to walk every block height.

Request:

```http
GET /v4/verifiable-trust/changes
  ?fromBlock=<int>
  [&dids=<comma-separated DIDs>]
  [&corporation_id=<uint64>]
  [&channels=<comma-separated channel names>]
  [&includeParticipantCounts=true|false]
  [&includeIssuedCredentials=true|false]
  [&includeVerifiedCredentials=true|false]
  [&limit=<int>]
```

`limit` defaults to `100` and MUST NOT exceed `1000`. The `dids` and `corporation_id` parameters apply the same membership filter as the WS `subscribe` of [`IDX-VT-SUB-1`](#idx-vt-sub-1-subscribe-changes), including the one-hop validator-tree branch on each side. When **both** are present, the response is restricted to the **intersection** of the two filters; when **both** are omitted, the call subscribes-by-query to every indexed DID (wildcard).

Response:

```json
{
   "currentBlock":   1500300,
   "fromBlock":      1500005,
   "blocks": [
      {
         "block":     1500005,
         "blockTime": "2026-05-11T13:00:05Z",
         "changes":   [ /* same shape as `changes[]` in WS block messages */ ]
      },
      {
         "block":     1500012,
         "blockTime": "2026-05-11T13:01:05Z",
         "changes":   [ /* … */ ]
      }
   ],
   "nextFromBlock":  1500050
}
```

- `currentBlock` — Latest block the indexer has processed at the time of the response.
- `blocks[]` — Up to `limit` consecutive blocks in increasing order that contain at least one change matching the filters. **Blocks with no subscribed changes are omitted entirely.**
- `nextFromBlock` — Smallest block height strictly greater than the last returned block (or strictly greater than `fromBlock` if `blocks` is empty) for which the indexer **knows** further changes exist. `null` when the response has reached `currentBlock`.

Catch-up loop:

```
last_seen = client_last_seen_block
while true:
  r = GET /v4/verifiable-trust/changes?fromBlock=last_seen+1&...
  apply(r.blocks)
  if r.blocks:
    last_seen = r.blocks[-1].block
  if r.nextFromBlock is null:
    break
  last_seen = max(last_seen, r.nextFromBlock - 1)
```

The `nextFromBlock` cursor lets the client jump over arbitrarily long change-free ranges without making one HTTP call per block.

##### IDX-VT-QRY-3 List Indexed DIDs

A client that starts with an empty mirror needs a way to enumerate the universe of DIDs the indexer tracks at a frozen snapshot block, then resolve each via `/v4/verifiable-trust/resolve` to populate its initial state.

Request:

```http
GET /v4/verifiable-trust/dids
  [?cursor=<opaque string>]
  [&corporation_id=<uint64>]
  [&limit=<int>]
At-Block-Height: <int>
```

The snapshot block is selected via the `At-Block-Height` HTTP request header per [Conventions](#at-block-height-header); when omitted, the latest indexed block is used. `limit` defaults to `1000` and MUST NOT exceed `10000`. When `corporation_id` is provided, the response enumerates only the DIDs in that Corporation's expanded membership set at the snapshot block (same direct-ownership + one-hop validator-tree semantics as the WS `subscribe` of [`IDX-VT-SUB-1`](#idx-vt-sub-1-subscribe-changes)).

Response:

```json
{
   "atBlock": 1500004,
   "dids": [
      "did:webvh:QmRhJBzLMF6L3REha9xFpLgxui9X5tFm4TDxHoEHpA8Kpr:organization.vs.hologram.zone",
      "did:webvh:QmZ8Y3xRkH2pV4qTw9nL7sFmJg6cN5dB1aWxKvE3uPyT8r:corp.acme.example",
      "did:web:ecosystem.eu-passport.example"
   ],
   "nextCursor": "eyJvZmZzZXQiOjEwMDB9"
}
```

- `atBlock` — Echo of the resolved snapshot block (the value of `At-Block-Height` if provided, otherwise the latest indexed block at evaluation time). The "DID universe" at block `B` is the set of DIDs the indexer can resolve at `B`: every Corporation `did`, every Ecosystem `did`, the Corporation-side DID of every Participant entry that is in scope (per the resolver's [participation states](#example-resolution-response)), and any DID previously evaluated by the resolver that the indexer is still tracking.
- `dids[]` — Page of indexed DIDs in stable sort order across pages.
- `nextCursor` — Opaque pagination cursor; `null` (or absent) on the last page.

##### Bootstrap pattern

The recommended initial-sync sequence for a client with an empty mirror:

1. **Connect** to `WS /v4/verifiable-trust/subscribe` and read the `ready` message.
2. **Subscribe** with the desired `dids` / `channels`, buffering every incoming block message **without applying it** from connect (a block MAY be delivered before the acknowledgement arrives), then wait for the `subscribed` acknowledgement and capture `B = subscribed.block`. Keep buffering until step 5.
3. **Enumerate** the DID universe at block `B - 1` by calling `GET /v4/verifiable-trust/dids` with header `At-Block-Height: B-1` and paginating through `nextCursor`.
4. **Resolve** each enumerated DID by calling `POST /v4/verifiable-trust/resolve` with header `At-Block-Height: B-1` and the response selectors the client cares about. Persist the resulting state as the snapshot at block `B - 1`.
5. **Apply** the buffered WebSocket block messages in order (starting at block `B`), then continue applying live block messages as they arrive.

Because the snapshot is taken at the immutable past block `B - 1` and the WebSocket delivers from `B` onwards, no events are lost or double-counted.

##### Resume pattern

After a temporary disconnection, a client with a non-empty mirror resumes by:

1. Recording `last_seen_block` of the most recently applied WebSocket block message.
2. Reconnecting to `WS /v4/verifiable-trust/subscribe` and re-subscribing as before. Buffer incoming block messages.
3. Running the [`listChanges`](#idx-vt-qry-2-list-changes) catch-up loop from `fromBlock = last_seen_block + 1` until either `nextFromBlock` is `null` or it has reached the smallest block held in the WebSocket buffer.
4. Applying the buffered WebSocket block messages in order, deduplicated by `block` against anything already applied from `listChanges`.

#### Trust Registry Query Protocol v2 methods

The Verana indexer implements the [Trust Registry Query Protocol v2](https://trustoverip.github.io/tswg-trust-registry-query-protocol/) (TRQP v2.0) so any relying party can ask, in a registry-agnostic way, two complementary questions about a Verana corporation, ecosystem, or schema:

1. **Authorization** — *"Is this `entity_id` authorized by this `authority_id` for this `action` on this `resource`?"*
2. **Recognition** — *"Does this `authority_id` recognize that other authority `entity_id` to be authoritative for this `action` on this `resource`?"*

In Verana v4 both `authority_id` and `entity_id` are normal DIDs — corporations and ecosystems each carry a `did` and a governance framework (CGF and EGF respectively) — so the protocol is fully DID-native.

Both endpoints are pure query views over on-chain VPR state; they are PUBLIC and do not mutate state.

##### Verana TRQP profile

The Verana profile of TRQP v2 is identified by the profile version `verana-trqp/spec-v4`. It freezes the action vocabulary, resource grammar, context extensions, and trigger semantics for both endpoints, summarised below and detailed in the subsections that follow.

| Slot | Value |
| --- | --- |
| Profile version | `verana-trqp/spec-v4` |
| Authorization actions | `issue`, `verify`, `grant_issue`, `grant_verify`, `govern` |
| Recognition actions | same as authorization (action-invariant in v4) |
| Authorization resource grammar | VPR schema URI (`vpr:verana:<network>:cs:<n>`) |
| Recognition resource grammar | VPR schema URI |
| Authorization trigger | `Participant.role = role_of(action)` AND `state = "ACTIVE"` |
| Recognition trigger | `Ecosystem.did = entity_id` AND the Corporation referenced by `Ecosystem.corporationId` has `did = authority_id`, AND not archived |
| Recognition scope (v4) | corporation DID → ecosystem DID |
| Context extension | `session_id` (string), precedence `session_id` > `time` |
| Active states | `ACTIVE` |

Request and response payloads use the upstream ToIP TSWG schemas verbatim (see the per-direction subsections below for the canonical URLs). The Verana profile narrows their *interpretation*: it freezes `action` to a closed enum, `resource` to the VPR schema URI grammar, and constrains `authority_id` / `entity_id` to Verana corporation or ecosystem DIDs (see scope rules per endpoint). It also registers `context.session_id` (string) as a profile extension permitted by the upstream `context.additionalProperties` clause, and reserves a top-level `verana` object on responses for VPR-state breadcrumbs (opaque to non-Verana consumers; conformant because upstream does not set `additionalProperties: false`).

The full machine-readable Verana TRQP profile descriptor — including the action → `Participant.role` map, regex patterns, trigger semantics, scope rules, error messages, and discovery URLs — is published at [`schemas/v4/trqp/profile.json`](./schemas/v4/trqp/profile.json) (`$id`: `https://verana.io/schemas/v4/trqp/profile.json`).

Profile discovery. TRQP v2.0 does not standardise a profile-discovery mechanism, but per TRQP v2.0 §Identifiers/`authority_id` and §Conformance the **ecosystem governance framework** — of which this profile forms part — MUST be discoverable via the authority's identifier. Verana implements that requirement as follows:

- A Verana corporation or ecosystem MAY advertise a `TRQPEndpoint` service entry in its DID Document, pointing at the indexer's `/v4/trqp/v2/` base path.
- The indexer MUST serve the profile descriptor at `/v4/trqp/v2/profile` with `Content-Type: application/json`; the body is byte-identical to [`schemas/v4/trqp/profile.json`](./schemas/v4/trqp/profile.json).
- The action vocabulary, resource grammar, trigger semantics, and scope rules in the descriptor MUST match the table above; the descriptor is the canonical machine-readable form, this table is its prose summary.

##### IDX-TRQP-QRY-1 TRQP Authorize

`POST /v4/trqp/v2/authorization`

Direction: ecosystem → corporation. Derived from `Participant` entries.

###### Action vocabulary

| `action` | Verana `Participant.role` | Wire-level meaning |
| --- | --- | --- |
| `issue` | `ISSUER` | corporation may issue credentials of `resource` schema in `authority` ecosystem |
| `verify` | `VERIFIER` | corporation may verify credentials of `resource` schema |
| `grant_issue` | `ISSUER_GRANTOR` | corporation may grant `issue` to others for `resource` schema |
| `grant_verify` | `VERIFIER_GRANTOR` | corporation may grant `verify` to others for `resource` schema |
| `govern` | `ECOSYSTEM` | corporation holds root governance for the `resource` schema in the `authority` ecosystem |

###### Derivation

TRQP authorization is conceptually a DID-based predicate: `(authority DID, entity DID, action, resource URI, time) → boolean`. The query inputs `E` and `V` are DIDs and `R` is a VPR schema URI; the result is a boolean (plus optional breadcrumbs). Any internal translation from DID to stable Corporation/Ecosystem id, or from URI to stable schema id, is an implementation detail of the indexer; it is not exposed on the TRQP wire.

```
For a query (authority=E, entity=V, action=A, resource=R, time=T):
  active_rows = Participant entries where
                  the Participant's controlling Ecosystem has did = E
                AND the Participant's controlling Corporation has did = V
                AND role       = role_of(A)
                AND schema.uri = R
                AND state      = "ACTIVE"
                AND validAt(T)
  authorized = active_rows is non-empty
```

###### Authorization request schema

Authorization requests use the upstream ToIP TSWG schema [`trqp_authorization_request.schema.json`](https://trustoverip.github.io/tswg-trust-registry-protocol/approved/schema/trqp_authorization_request.schema.json) (`$id`: `trqp-authorization-request`) verbatim. Verana-specific narrowing of `action`, `resource`, `authority_id`, `entity_id`, and `context` is described by the [Verana TRQP profile descriptor](./schemas/v4/trqp/profile.json).

###### Authorization response schema

Authorization responses use the upstream ToIP TSWG schema [`trqp_authorization_response.schema.json`](https://trustoverip.github.io/tswg-trust-registry-protocol/approved/schema/trqp_authorization_response.schema.json) (`$id`: `trqp-authorization-response`) verbatim. The Verana profile additionally permits a top-level `verana` object whose shape is described by the [Verana TRQP profile descriptor](./schemas/v4/trqp/profile.json); the upstream schema does not set `additionalProperties: false`, so this extension is conformant.

###### Example authorization request

*"Does the EU-Passport ecosystem authorize Acme Corp to `issue` schema 42?"*

```json
POST /v4/trqp/v2/authorization
{
   "authority_id": "did:webvh:Qm…:ecosystem.eu-passport.example",
   "entity_id":    "did:webvh:Qm…:corp.acme.example",
   "action":       "issue",
   "resource":     "vpr:verana:vna-mainnet-1:cs:42",
   "context":      { "time": "2026-05-11T13:00:00Z" }
}
```

###### Example authorization response

```json
{
   "authority_id":   "did:webvh:Qm…:ecosystem.eu-passport.example",
   "entity_id":      "did:webvh:Qm…:corp.acme.example",
   "action":         "issue",
   "resource":       "vpr:verana:vna-mainnet-1:cs:42",
   "authorized":     true,
   "time_requested": "2026-05-11T13:00:00Z",
   "time_evaluated": "2026-05-11T13:00:00Z",
   "verana": {
      "participant_state": "ACTIVE",
      "since":             "2026-04-12T08:00:00Z",
      "deposit":           "10000000uvna"
   }
}
```

##### IDX-TRQP-QRY-2 TRQP Recognize

`POST /v4/trqp/v2/recognition`

Direction: Corporation → Ecosystem. Derived from `Ecosystem` entries — specifically the controlling-Corporation reference each Ecosystem carries (VPR-level `Ecosystem.corporation` group field; surfaced in the graph as `Ecosystem.corporationId`). TRQP itself remains DID-only at the wire level — the `authority_id` (Corporation DID) and `entity_id` (Ecosystem DID) inputs are translated to internal stable ids only inside the indexer when evaluating the predicate. Per-Participant-entry recognition (e.g. ECOSYSTEM-role recognition for individual Credential Schemas, Ecosystem-to-Ecosystem federation, Corporation-to-Corporation peer recognition) is **out of scope for v4**.

###### Action vocabulary

Recognition reuses the authorization action enum (`issue`, `verify`, `grant_issue`, `grant_verify`, `govern`). In v4 the boolean answer is **action-invariant**: a Corporation that controls an Ecosystem is acknowledging that Ecosystem's framework as authoritative for every action governed within the Ecosystem's scope. The `action` argument is preserved on the wire for TRQP conformance and forward compatibility with future per-action recognition semantics.

###### Derivation

TRQP recognition is conceptually a DID-based predicate: `(authority DID, entity DID, action, resource URI, time) → boolean`. The query inputs `V` and `E` are DIDs and `R` is a VPR schema URI; the result is a boolean (plus optional breadcrumbs). Any internal translation from DID to stable Corporation/Ecosystem id, or from URI to stable schema id, is an implementation detail of the indexer; it is not exposed on the TRQP wire.

```
For a query (authority=V, entity=E, action=A, resource=R, time=T):
  ecosystem_row = Ecosystem entry where
                    did = E
                  AND its controlling Corporation has did = V
                  AND archived IS NULL
                  AND validAt(T)
  schema_row    = CredentialSchema entry where
                    uri = R
                  AND schema is owned by ecosystem_row
                  AND validAt(T)
  recognized = (ecosystem_row is non-empty) AND (schema_row is non-empty)
```

In words: V recognizes E for resource R iff (a) V is the Corporation that controls E, AND (b) R is a Credential Schema governed by E.

###### Recognition request schema

Recognition requests use the upstream ToIP TSWG schema [`trqp_recognition_request.schema.json`](https://trustoverip.github.io/tswg-trust-registry-protocol/approved/schema/trqp_recognition_request.schema.json) (`$id`: `trqp-recognition-request`) verbatim. Verana-specific narrowing is described by the [Verana TRQP profile descriptor](./schemas/v4/trqp/profile.json).

###### Recognition response schema

Recognition responses use the upstream ToIP TSWG schema [`trqp_recognition_response.schema.json`](https://trustoverip.github.io/tswg-trust-registry-protocol/approved/schema/trqp_recognition_response.schema.json) (`$id`: `trqp-recognition-response`) verbatim. The Verana profile additionally permits a top-level `verana` object whose shape is described by the [Verana TRQP profile descriptor](./schemas/v4/trqp/profile.json).

###### Example recognition request

*"Does Acme Corp recognize EU-Passport to be authoritative to `issue` schema 42?"*

```json
POST /v4/trqp/v2/recognition
{
   "authority_id": "did:webvh:Qm…:corp.acme.example",
   "entity_id":    "did:webvh:Qm…:ecosystem.eu-passport.example",
   "action":       "issue",
   "resource":     "vpr:verana:vna-mainnet-1:cs:42",
   "context":      { "time": "2026-05-11T13:00:00Z" }
}
```

###### Example recognition response

```json
{
   "authority_id":   "did:webvh:Qm…:corp.acme.example",
   "entity_id":      "did:webvh:Qm…:ecosystem.eu-passport.example",
   "action":         "issue",
   "resource":       "vpr:verana:vna-mainnet-1:cs:42",
   "recognized":     true,
   "time_requested": "2026-05-11T13:00:00Z",
   "time_evaluated": "2026-05-11T13:00:00Z",
   "verana": {
      "ecosystem_active_egf_version": 7,
      "controlling_since":            "2026-03-01T00:00:00Z"
   }
}
```

###### Out-of-scope queries

If `authority_id` is not the DID of an active Corporation entry, or `entity_id` is not the DID of an active Ecosystem entry, the endpoint MUST return `recognized: false` with an explanatory `message`:

```json
{
   "authority_id":   "<echo>",
   "entity_id":      "<echo>",
   "action":         "<echo>",
   "resource":       "<echo>",
   "recognized":     false,
   "time_evaluated": "2026-05-11T13:00:00Z",
   "message":        "out of v4 recognition scope (corporation → ecosystem only)"
}
```

##### Context: `session_id` extension

Both endpoints accept an optional `context.session_id` extension to bind the answer to a specific [VPR `MOD-PP-MSG-10`] participant session. When supplied:

> Note: `session_id` is needed in most cases for issuance and verification.

- `session_id` takes precedence over `time`.
- The resolver verifies that `time` (if also given) falls inside the session's validity window; if outside, the answer is `authorized: false` (or `recognized: false`) with `message: "session out of window"`.
- If the session does not exist, the answer is `false` with `message: "session not found"`.

When `session_id` is omitted, the answer is point-in-time per the standard `time` argument; if both are omitted, the answer is computed against the latest block.