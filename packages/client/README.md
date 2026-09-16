`@verana-labs/vs-agent-client`

# VS Agent Client

A typed `fetch` wrapper over the v2 [Administration API](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#administration-api) of [VS Agent](https://github.com/verana-labs/vs-agent), plus an event dispatcher for the [Events API](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#events-api) webhook. No runtime dependencies, Node 18 or newer.

## Installation

```sh
pnpm add @verana-labs/vs-agent-client
```

## Client

```ts
import { ApiClient } from '@verana-labs/vs-agent-client'

const client = new ApiClient('http://localhost:3000')

const { id } = await client.didcomm.sendBasicMessage({ connectionId, content: 'Hello' })
```

`baseUrl` is the admin origin. The client appends `/v2`.

Auth. An agent in `ADMIN_API_AUTH_MODE=internal`, or a caller inside `ADMIN_API_TRUSTED_NETWORKS` in either mode, needs no token. A caller outside the trusted networks of an agent in `corporation` mode runs the ADR-036 flow with its own Cosmos signer: `client.auth.challenge({ account })`, sign `vs-agent-admin-auth:${nonce}`, `client.auth.token({ account, pubKey, signature, nonce })`, then build the client with the returned token. Tokens live 900 seconds, build a new `ApiClient` to refresh.

```ts
const client = new ApiClient('https://agent.example.com', { token })
```

Method names, verbs, paths and field names are the spec [Method Summary](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#method-summary) verbatim, grouped by scope: `client.auth`, `client.agent`, `client.didcomm`, `client.anoncreds`, `client.vt`. Path parameters are positional, bodies and queries are one object. Dates are ISO 8601 strings.

List methods return a page. Loop on `nextCursor`:

```ts
let cursor: string | undefined
do {
  const page = await client.didcomm.listConnections({ limit: 100, cursor })
  for (const connection of page.items) console.log(connection.id)
  cursor = page.nextCursor ?? undefined
} while (cursor)
```

Errors. A non-2xx response throws `ApiError` with `code` (the spec error code, for example `UNKNOWN_ID`), `status` and `message`. A response without the error envelope throws `ApiError` with code `HTTP_ERROR`. Transport failures propagate as the `fetch` rejection.

The chat and mrtd module methods (`sendReceipts`, `sendMenu`, `requestMrz` and the rest) exist only when the plugin is loaded on the agent. Without it they answer `404 UNKNOWN_ID`.

## Events

`EventDispatcher` routes a webhook envelope to handlers registered by event type. `data` is typed per event.

```ts
import { EventDispatcher, EventEnvelope } from '@verana-labs/vs-agent-client'

const events = new EventDispatcher()
  .on('didcomm.basic-messages.message-received', async ({ connectionId, content }) => {
    await client.didcomm.sendBasicMessage({ connectionId, content: `You said: ${content}` })
  })
  .on('didcomm.connections.state-updated', data => {
    if (data.state === 'completed' && data.previousState !== 'completed') console.log('new connection', data.id)
  })

app.post('/events', async (req, res) => {
  await events.dispatch(req.body as EventEnvelope)
  res.sendStatus(204)
})
```

Handlers run in registration order. A handler rejection propagates, so answer non-2xx and the agent logs the failed delivery ([VSA-EVT-DEL-3](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-evt-del-delivery)). An event type with no handler is a no-op.

The dispatcher does not discard duplicate deliveries. [VSA-EVT-DEL-5](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-evt-del-delivery) makes that the consumer's job: keep the seen `id` values and skip an envelope you already handled before calling `dispatch`.

The event set is open. `EventEnvelope` covers the types the agent emits today and `UnknownEventEnvelope` names the rest (for example `didcomm.question-answer.question-received`). Check `isEventEnvelope(envelope)` first: inside that branch a `switch` on `envelope.type` narrows `envelope.data`, in the else branch `envelope.data` is `unknown`.

## Not available yet

The spec lists these, main does not serve them yet:

- `sendInvitation` (`POST /didcomm/invitations`), lands with [verana-labs/vs-agent#716](https://github.com/verana-labs/vs-agent/pull/716)
- `deleteCredentialExchange` (`DELETE /didcomm/credential-exchanges/{id}`)
- every OpenID4VC method under `/openid4vc`
- `connectionId` on `createPresentationRequest` and `createCredentialOffer`, both mint an out-of-band invitation and reject the field
- `parentConnectionId` on connection records and the `listConnections` filter
