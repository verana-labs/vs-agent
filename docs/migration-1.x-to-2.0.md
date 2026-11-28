# Migrating a controller from VS Agent 1.x to 2.0

VS Agent 2.0 replaces the 1.x Administration API and Events API with the Administration API v2 and
the Events API of the [VS Agent specification](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md).
Neither is backwards compatible. This page lists what a controller written against 1.13 has to
change, and what 2.0 does not do any more. The environment variables are in the
[README](../apps/vs-agent/README.md#environment-variables); the full API is in
[`docs/api/openapi.json`](./api/openapi.json).

## Administration API

- Every path starts with `/v2` and belongs to a scope: `/v2/agent`, `/v2/didcomm`, `/v2/anoncreds`,
  `/v2/vt`, `/v2/openid4vc`. Fields are camelCase.
- `POST /v1/message` with a `type` is gone. Each protocol has its own routes under `/v2/didcomm`
  (`basic-messages`, `receipts`, `reactions`, `user-profile`, `media-sharing`, `calls`,
  `action-menu`, `question-answer`, `mrtd`, `credential-offer`, `presentation-request`). A route
  that sends a message returns the `id` of the sent message; a route that starts an exchange
  returns the exchange record.
- Lists are paginated with a cursor (`limit`, `cursor`, `nextCursor`), not returned whole.
- Errors come as `{ "error": { "code", "message", "details?" } }`, with stable codes such as
  `UNKNOWN_ID`, `INVALID_INPUT`, `INVALID_STATE`.
- The agent information at `GET /v2/agent/info` returns `did` and `version`. `label`,
  `isInitialized` and `publicDid` are gone: `AGENT_LABEL` is not read any more, and the readiness
  probe at `GET /v2/agent/health/ready` replaces `isInitialized`.
- A send body takes no caller-chosen `id`. The agent assigns the DIDComm message id and returns
  it. A retried request sends twice.

### Credential issuance

- An offer needs a credential definition. 1.x accepted `jsonSchemaCredentialId` and registered the
  AnonCreds credential definition on the fly. In 2.0 the controller creates it once with
  `POST /v2/anoncreds/credential-definitions` and passes `credentialDefinitionId` to
  `POST /v2/didcomm/credential-offer`.
- `autoAccept` defaults to `false`, as the specification requires. 1.x issued the credential as
  soon as the holder accepted the offer. A 2.0 controller either passes `autoAccept: true` on the
  offer, or waits for the `request-received` state and calls
  `POST /v2/didcomm/credential-exchanges/{id}/accept`.
- Revoking a credential (`POST /v2/anoncreds/revoke-credential`) updates the registry only. 1.x
  also sent a revocation notification to the holder over DIDComm. 2.0 does not, and the VT-flow
  route `revoke-credential` of 1.x is gone.
- A credential proposal from the holder arrives as a `proposal-received` state. 1.x accepted it
  with a `credential-issuance` message on the thread; 2.0 has no route to accept it.

### Connections and invitations

- The 1.x `terminate-connection` message is `POST /v2/didcomm/connections/{id}/terminate`: the
  agent tells the peer that the connection ends and keeps the record, which becomes `abandoned`.
  `DELETE /v2/didcomm/connections/{id}` hangs up and deletes the record; `?notify=false` deletes it
  without the hangup, as the 1.x delete did.
- A connection that the peer hung up is `abandoned` too, reported on
  `didcomm.connections.state-updated`. 1.x reported it as a `terminated` state.
- The agent creates invitations only. `POST /v1/invitation/receive` has no counterpart.
- `GET /v1/qr` and the redirect of the default URL to the invitation are gone.
- Presentation requests take no `callbackUrl` or `ref`. The result arrives on the Events API, as
  `didcomm.presentations.state-updated`.
- The features a peer discloses (for example the eMRTD reading capability) arrive on the Events
  API as `didcomm.discover-features.disclose-received`, see below. They are not readable on the
  connection record; 1.x returned them in the connection metadata.
- A share that answers a `request-media` names the request as `parentThreadId` on
  `POST /v2/didcomm/media-sharing`, and the media-sharing events carry `parentThreadId`. 1.x used
  `threadId` for that link. Basic messages, presentation requests and credential offers take a
  `parentThreadId` as well, and basic message records carry `threadId`.

### Verifiable Trust

- `POST /v1/vt/issue-credential`, the `/v1/vt/linked-credentials` routes and the
  `/v1/vt/json-schema-credentials` routes are gone. The agent publishes its own credentials and the
  JSON Schema Credentials of the types it issues itself, from its on-chain permissions.
- Credential types are now AnonCreds credential definitions (`/v2/anoncreds/credential-definitions`),
  with `import` but no `export`.
- Flows live under `/v2/vt/flows`, with `start-validation`, `validate` and `reject`.

### Other removals

- Automatic disclosure of the agent profile (`USER_PROFILE_AUTODISCLOSE`): the controller answers
  a `request-profile-received` event with `POST /v2/didcomm/user-profile/send`.
- Redis (`REDIS_HOST`, `REDIS_PASSWORD`): 2.0 has no message queue.

## Events API

- 1.x posted each event to `${EVENTS_BASE_URL}/${type}`, with the event as the body. 2.0 posts one
  envelope `{ id, type, timestamp, data }` to `EVENTS_WEBHOOK_URL`, with
  `Authorization: Bearer ${EVENTS_WEBHOOK_API_KEY}` when the key is set. Deliveries can repeat:
  discard an envelope whose `id` was already seen.
- Event types are renamed and split per protocol:

  | 1.x | 2.0 |
  | --- | --- |
  | `connection-state-updated` | `didcomm.connections.state-updated` (the connection record plus `previousState`) and `didcomm.invitations.state-updated`. A peer hangup is `state: 'abandoned'`, not `terminated` |
  | `connection-state-updated` with `state: 'updated'` and `metadata` | `didcomm.discover-features.disclose-received`: `connectionId`, `threadId` and `features`, each with `featureType`, `id` and its own properties (`roles`, `value`) |
  | `message-received` with a `type` | one event per protocol, for example `didcomm.basic-messages.message-received`, `didcomm.receipts.message-receipts-received`, `didcomm.user-profile.profile-received`, `didcomm.mrtd.emrtd-data-received` |
  | `message-state-updated` | `didcomm.credential-exchanges.state-updated` for issuance; receipts of other messages come as `didcomm.receipts.message-receipts-received` |
  | `presentation-state-updated` | `didcomm.presentations.state-updated` (the presentation record plus `previousState`) |
  | `vt-flow-state-updated` | `vt.flows.state-updated` |
  | `indexer-notification` | `vpr.notification` |

- A refused exchange shows as `state: 'abandoned'` with `errorMessage` on the record, not as a
  `declined` event.
- The answer to a question (`didcomm.question-answer.answer-received`) carries the `text` of the
  selected response. 1.x `menu-select` carried the item `id`.

## Environment variables

Renamed variables are carried over with a warning at startup until 3.0; removed variables are
reported and ignored.

| 1.x | 2.0 |
| --- | --- |
| `ADMIN_PORT` | `ADMIN_API_PORT` |
| `AGENT_PORT` | `PUBLIC_API_PORT` |
| `ADMIN_LOG_LEVEL` | `ADMIN_API_LOG_LEVEL` |
| `EVENTS_BASE_URL` | `EVENTS_WEBHOOK_URL` (one envelope per event, see above) |
| `MASTER_LIST_CSCA_LOCATION` | `MRTD_MASTER_LIST_CSCA_LOCATION` |
| `SELF_ISSUED_VTC_ORG_*`, `SELF_ISSUED_VTC_SERVICE_*` | `ECS_CLAIMS_ORG_*`, `ECS_CLAIMS_SERVICE_*`, see [ECS credential claims](../apps/vs-agent/README.md#ecs-credential-claims) |
| `AGENT_ENDPOINT`, `AGENT_ENDPOINTS` | derived from `PUBLIC_API_BASE_URL` |
| `AGENT_PUBLIC_DID` | the agent creates its DID from `PUBLIC_API_BASE_URL` and `AGENT_PUBLIC_DID_METHOD` |
| `AGENT_DIDCOMM_VERSIONS` | both versions are always served |
| `AGENT_LABEL`, `AGENT_NAME`, `AGENT_INVITATION_BASE_URL`, `AGENT_INVITATION_IMAGE_URL`, `REDIRECT_DEFAULT_URL_TO_INVITATION_URL`, `UI_WELCOME_MESSAGE`, `UI_VERANA_CHAIN_ID`, `UI_VERANA_INDEXER_BASE_URL`, `USER_PROFILE_AUTODISCLOSE`, `ADMIN_API_EXTERNAL_PORT`, `REDIS_HOST`, `REDIS_PASSWORD` | removed |

## Client packages

- `@verana-labs/vs-agent-client` exposes the v2 API as `client.agent`, `client.didcomm`,
  `client.anoncreds`, `client.vt` and `client.openid4vc`, and an `EventDispatcher` typed per event.
  See its [README](../packages/client/README.md).
- `@verana-labs/vs-agent-nestjs-client` consumes the v2 events. Its
  [README](../packages/nestjs-client/README.md) lists the database migration a 1.x host writes.
