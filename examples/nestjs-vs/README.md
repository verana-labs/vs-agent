# Demo NestJS VS Chatbot

A chatbot built on `@verana-labs/vs-agent-nestjs-client`. It keeps a session per connection in PostgreSQL, sends a contextual menu with two actions, `/credential` issues a demo credential and `/revoke` revokes it.

## Layout

```
src/
  app.module.ts      registers EventsModule and the i18n and config modules
  core.module.ts     TypeORM setup, registers the entities of the client and the session entity
  core.service.ts    EventHandler implementation and the chatbot logic
  common/enums/      commands and state machine steps
  config/            app and logger config
  i18n/              messages per language
  models/            session entity
```

## Wiring

`app.module.ts` registers the module once:

```typescript
EventsModule.register({
  url: process.env.VS_AGENT_ADMIN_URL || 'http://localhost:3000',
  eventHandler: CoreService,
  modules: { connections: true, credentials: true },
})
```

`core.module.ts` owns the database and registers `ConnectionEntity`, `CredentialEntity` and `RevocationRegistryEntity` next to its own `SessionEntity`, and exports `TypeOrmModule` so the client's providers reach the repositories.

`CoreService` implements `EventHandler`:

- `newConnection` creates the session and sends the contextual menu. It also fires for the connection each accepted credential offer creates, so the holder gets the menu there too.
- `closeConnection` resets the session.
- `onEvent` handles the chat events that carry a `connectionId` (basic messages, menu performs, profiles, media, MRTD data) and ends by resending the menu. Every other event is ignored.

`/credential` calls `credentialService.issue` and sends the returned `shortUrl` as a basic message. The wallet opens it to receive the credential. `/revoke` calls `credentialService.revoke` on the latest accepted credential of the session's connection.

The credential definition is created on startup by `createCredentialDefinition(JSON_SCHEMA_CREDENTIAL_ID, { supportRevocation: true, maximumCredentialNumber: 5 })`. The agent needs an active ISSUER Participant for that schema on a Verana ecosystem, see [examples/vt-flow-demo](../vt-flow-demo/README.md). Without `JSON_SCHEMA_CREDENTIAL_ID` the startup logs a warning and `/credential` fails.

The configured `ApiClient` is injected with `@Inject(VS_AGENT_CLIENT)`.

## Environment

| Variable | Default | Description |
|---|---|---|
| `AGENT_PORT` | `5000` | Port of the chatbot, the agent posts events to `POST /events` on it |
| `VS_AGENT_ADMIN_URL` | `http://localhost:3000` | Admin API origin, the client appends `/v2` |
| `JSON_SCHEMA_CREDENTIAL_ID` | unset | JSON Schema Credential of the credential to issue |
| `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB_NAME` | `postgres`, `demo`, `2060demo`, `demo` | Database |
| `LOG_LEVEL` | `1` | `1` log and error, `2` adds debug, `3` log, debug and error |

## Running

```bash
pnpm install
pnpm build
pnpm start
```

Or with Docker Compose from this directory: `docker-compose up --build`. Set `PUBLIC_API_BASE_URL` and `EVENTS_WEBHOOK_URL` in `docker-compose.yml` to the public URLs that front ports `2801` and `2802`.

Swagger for the chatbot itself is served at `/api`.

## Adapting

Start from `core.service.ts`, `core.module.ts` and `app.module.ts`. Add commands to `common/enums/cmd.enum.ts` and state machine steps to `common/enums/state-step.enum.ts`. Add i18n keys under `src/i18n/<lang>/msg.json`. The `@verana-labs/vs-agent-nestjs-client` [README](../../packages/nestjs-client/README.md) documents the module options, the `EventHandler` interface and the credential service.
