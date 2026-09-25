# @verana-labs/vs-agent-nestjs-client

NestJS module for hosts of a VS Agent. It mounts the Events API webhook, keeps a small table of connections and issued credentials, and provides a configured `ApiClient` from `@verana-labs/vs-agent-client` for injection. Everything the client exports is re-exported here.

## Setup

```typescript
import { EventsModule } from '@verana-labs/vs-agent-nestjs-client'

@Module({
  imports: [
    EventsModule.register({
      url: process.env.VS_AGENT_ADMIN_URL,
      eventHandler: CoreService,
      modules: { connections: true, credentials: true },
    }),
  ],
})
export class AppModule {}
```

Options:

| Option | Description |
|---|---|
| `url` | Admin API origin, for example `http://localhost:3000`. The client appends `/v2` |
| `token` | Bearer token for corporation mode. Omit in internal mode |
| `webhookApiKey` | When set, `POST /events` requires `Authorization: Bearer <webhookApiKey>` |
| `eventHandler` | Class implementing `EventHandler`, registered as a provider |
| `modules.connections` | `true` or `{ requireProfile }`. Tracks connections and derives `newConnection` and `closeConnection`. With `requireProfile`, `newConnection` waits for a profile carrying `preferredLanguage` |
| `modules.credentials` | Tracks issued credentials and their revocation registries |
| `modules.stats` | Registers `StatProducerService` |
| `statOptions` | JMS broker settings for the stats producer (`host`, `port`, `queue`, `username`, `password`, `reconnectLimit`, `threads`, `delay`) |

The module is global. It exports `VS_AGENT_CLIENT` and whichever of `ConnectionsRepository`, `ConnectionsService`, `CredentialService` and `StatProducerService` are registered.

The host owns the database. Register the entities it uses with `TypeOrmModule.forFeature([ConnectionEntity, CredentialEntity, RevocationRegistryEntity])` in a module that exports `TypeOrmModule`. Migration based deployments coming from the v1 client write one migration for the `connections.status` enum (now `start`, `completed`, `terminated`), the dropped `connections.metadata` column and the `credentials.threadId` to `credentialExchangeId` rename.

## Webhook

The module mounts `POST /events` and answers 204. Point the agent's `EVENTS_WEBHOOK_URL` at it. A repeated envelope `id` is discarded before dispatch. Errors thrown by `onEvent` propagate, so the agent logs the delivery as failed.

## EventHandler

```typescript
export interface EventHandler {
  newConnection(connectionId: string): Promise<void> | void
  closeConnection(connectionId: string): Promise<void> | void
  onEvent(envelope: EventEnvelope | UnknownEventEnvelope): Promise<void> | void
}
```

`onEvent` receives every envelope after the module has acted on it. Check `isEventEnvelope(envelope)` first, then switch on `envelope.type` to get typed `envelope.data`. The else branch is reachable: extension modules emit types the map does not list, and there `envelope.data` is `unknown`.

## Connections

`didcomm.connections.state-updated` with `state: 'completed'` creates the row. `didcomm.user-profile.profile-received` stores the profile. `newConnection` fires once per connection, once it is `completed` and a profile with `preferredLanguage` has been received when `requireProfile` is true (the default), or right after `completed` when it is false. `closeConnection` fires on `state: 'abandoned'`. A peer hangup by DID rotation emits no Events API event today, so it does not reach `closeConnection`.

`newConnection` also fires for the connection each accepted credential offer or proof request creates, since those go through an out of band invitation.

## Credentials

`CredentialService` wraps the v2 credential offer flow.

- `createCredentialDefinition(jsonSchemaCredentialId, { supportRevocation, maximumCredentialNumber })` returns the definition for that schema, creating it and two revocation registries when missing. Call it once at startup.
- `issue(claims, { connectionId, refId, credentialDefinitionId, jsonSchemaCredentialId, revokeIfAlreadyIssued })` picks a definition, reserves a revocation index and calls `createCredentialOffer` with `autoAccept: true`. It returns the offer, hand its `shortUrl` to the user. `connectionId` is bookkeeping only, it is the connection `revoke(connectionId)` looks up by. `issue` no longer registers a credential definition, run `createCredentialDefinition` first.
- `didcomm.credential-exchanges.state-updated` with `role: 'issuer'` marks the row accepted on `done` and rejected on `declined` or `abandoned`.
- `revoke(connectionId, credentialExchangeId?)` revokes the latest accepted credential of the connection, or the given exchange, through `revokeCredential`.

## Client

Inject the configured client anywhere:

```typescript
constructor(@Inject(VS_AGENT_CLIENT) private readonly client: ApiClient) {}

await this.client.didcomm.sendBasicMessage({ connectionId, content: 'hello' })
```

## Stats

With `modules.stats` the `StatProducerService` sends `StatEvent` messages to a JMS queue. Call `spool(statClass, entityId, [new StatEnum(0, 'value')])` or `spoolSingle`.
