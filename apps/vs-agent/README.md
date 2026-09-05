# VS Agent

Verifiable Service Agent is a web application that allows to create Verifiable Services.

## Conformance

This implementation targets the [VS Agent Specification, Verana v4](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md) (draft). The specification is the reference for behaviour; this README documents what is specific to this implementation and how to deploy it.

Three version numbers appear around VS Agent, and they move independently:

| Axis | Current value | Where it shows |
| --- | --- | --- |
| Verana release the specification belongs to | v4 | The `v4/` directory of `verana-spec`; shared by every component specification of that release |
| Administration API version | v2 | The `/v2` prefix of every Admin API path |
| Implementation version | 2.x | The package version and the Docker image tag |

## Configuration

Most configuration of VS Agent is done by environment variables. These variables might be set also in `.env` file in the form of KEY=VALUE (one per line).

### Variables defined by the specification

The semantics of these variables are normative in [[VSA-VTI-CFG-ENV]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-container-environment-variables); the table only indexes them by group. Requirement levels follow the specification.

| Group | Variables | Specification |
| --- | --- | --- |
| Identity and Corporation | `VERANA_CORPORATION_ID` (REQUIRED), `VERANA_ACCOUNT_MNEMONIC` (REQUIRED) | [[VSA-VTI-CFG-ENV-ID]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-id-identity-and-corporation) |
| Network | `VERANA_RPC_ENDPOINT_URL` (REQUIRED), `VERANA_INDEXER_BASE_URL` (REQUIRED), `VERANA_CHAIN_ID`, `VERANA_INDEXER_SUBSCRIPTION_SCOPE`, `VERANA_INDEXER_DEFAULT_HANDLERS_OVERRIDE`, `VERANA_GAS_ADJUSTMENT`, `VERANA_AUTO_TRIGGER_RESOLVER` | [[VSA-VTI-CFG-ENV-NET]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-net-network-configuration) |
| Agent mode | `AGENT_MODE`, `AGENT_DELEGATED_PARENT_VS_DID` (CONDITIONAL), `TRUSTED_ECS_ECOSYSTEM_DIDS` (CONDITIONAL) | [[VSA-VTI-CFG-ENV-MODE]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-mode-agent-configuration-mode) |
| ECS credential claims | `ECS_CLAIMS_ORG_*`, `ECS_CLAIMS_PERSONA_*`, `ECS_CLAIMS_SERVICE_*` (the Service claims are REQUIRED in `standalone` mode) | [[VSA-VTI-CFG-ENV-ECS]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-ecs-ecs-credential-claims) |
| Agent runtime | `PUBLIC_API_BASE_URL` (REQUIRED), `PUBLIC_API_PORT`, `AGENT_PUBLIC_DID_METHOD`, `MASTER_LIST_CSCA_LOCATION` | [[VSA-VTI-CFG-ENV-RT]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-rt-agent-runtime) |
| Administration API | `ADMIN_API_PORT`, `ADMIN_API_AUTH_MODE`, `ADMIN_API_TRUSTED_NETWORKS`, `ADMIN_API_PUBLIC_URL` (CONDITIONAL), `ADMIN_API_CORPORATION_ALLOWED_ACCOUNTS` (CONDITIONAL) | [[VSA-VTI-CFG-ENV-ADM]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-adm-administration-api) |
| Events API | `EVENTS_WEBHOOK_URL`, `EVENTS_WEBHOOK_API_KEY` | [[VSA-VTI-CFG-ENV-EVT]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-evt-events-api) |
| OpenID4VC | `OID4VC_CONFIG_FILE` | [[VSA-VTI-CFG-ENV-OID]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-oid-openid4vc) |
| Logging | `AGENT_LOG_LEVEL`, `ADMIN_API_LOG_LEVEL` | [[VSA-VTI-CFG-ENV-LOG]](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#vsa-vti-cfg-env-log-logging) |

Deployment notes:

- Expose the public port to the internet and set `PUBLIC_API_BASE_URL` to the URL at which it is reachable. The agent derives its DID location from that URL: host, `%3A`-encoded port, and colon-separated path segments. You need HTTPS to fully support `did:web` and `did:webvh`.
- When `PUBLIC_API_BASE_URL` contains a path, the DID document is served at `<base>/did.json` and `<base>/did.jsonl` instead of under `/.well-known`. This assumes the reverse proxy strips the base path before forwarding requests to the agent.
- The persisted DID wins across restarts: if `PUBLIC_API_BASE_URL` later derives a different location than the one the DID was created for, the agent refuses to start. Restore the previous URL, or deliberately reset the wallet to mint a new DID.
- The agent serves placeholder resources at `/vt/default/logo.svg`, `/vt/default/terms.html` and `/vt/default/privacy.html`, which an operator may point the `ECS_CLAIMS_*_URI` variables at.
- Your backend receives events at `EVENTS_WEBHOOK_URL`, per the [Events API](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#events-api). A [NestJS client](../../packages/nestjs-client/) and a [base client](../../packages/client/) are available.

### Implementation-specific variables

These variables belong to this implementation (Credo, Askar, NestJS) and are not part of the specification.

#### Storage

| Variable                | Description                                                                                                                                                                   | Default value            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| AGENT_WALLET_ID         | ID for agent wallet                                                                                                                                                           | test-vs-agent            |
| AGENT_WALLET_KEY        | Key for agent wallet                                                                                                                                                          | test-vs-agent            |
| AGENT_WALLET_KEY_DERIVATION_METHOD | Wallet key derivation method: ARGON2I_INT, ARGON2_MOD or RAW                                                                                                       | ARGON2I_MOD              |
| POSTGRES_HOST           | PosgreSQL database host                                                                                                                                                       | None (use SQLite)        |
| POSTGRES_USER           | PosgreSQL database username                                                                                                                                                   | None                     |
| POSTGRES_PASSWORD       | PosgreSQL database password                                                                                                                                                   | None                     |
| POSTGRES_ADMIN_USER     | PosgreSQL database admin user                                                                                                                                                 | None                     |
| POSTGRES_ADMIN_PASSWORD | PosgreSQL database admin password                                                                                                                                             | None                     |
| REDIS_HOST              | Redis host used for message caching and asynchronous processing. The system requires this for production-ready performance.                                                   | None                     |
| REDIS_PASSWORD          | Password for connecting to the Redis instance.                                                                                                                                | None                     |
| TAILS_DIRECTORY_PATH    | Directory where AnonCreds revocation tails files are stored and served from. Must be on durable storage that survives restarts, and on a shared volume when running multiple instances. | `<home>/.afj/data/tails` |
| AGENT_AUTO_UPDATE_STORAGE_ON_STARTUP | Toggle automatic storage migration on startup. If true, the agent runs migrations and attempts to make a backup of the wallet on startup                          | true                     |
| AGENT_BACKUP_BEFORE_STORAGE_UPDATE   | Toggle backup before storage update. If true, the agent creates a backup of the wallet using Askar's export before performing storage migrations                   | true                     |

VS Agent supports two database backends:

- SQLite: suitable for demos and local testing
- Postgres: suitable for production environment

If you want to use SQLite, you won't need to care about any of these variables: VS Agent will create a local database using `AGENT_WALLET_ID` name and ciphering it with `AGENT_WALLET_KEY`.

On the other hand, if you go to production, you'll likely want to use a PostgreSQL DB, which will be used as soon as you set `POSTGRES_HOST`. You'll need to:

- define AGENT_WALLET_ID and AGENT_WALLET_KEY, since the ID will be used as the name of the database that will be used to store VS Agent wallet
- define the other `POSTGRES_*` parameters, including the ones for administration in case VS Agent wallet's database is not yet created in your Postgres host.

Another thing you'll likely to do if you go to production is to enable message caching and asynchronous processing, which is done by using Redis. By offloading message handling and enabling asynchronous processing, Redis helps optimize I/O operations and enhances the capacity to handle concurrent connections.

> **Note about Key derivation method**: By default, we use the strongest ARGON2I_MOD, but since this is the slowest one as well, depending on the security infrastructure you may choose a faster one.

> **Note about storage update and backup**: When migrating a wallet from SQLite to Postgres and restoring it in VS Agent with a new (sanitized) profile name, the automatic migration and backup can fail; disable them for that start.

#### Plugins and development

| Variable                  | Description                                                                                                                                  | Default value  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| VS_AGENT_PLUGINS          | Comma-separated list of plugins to load at startup. Set by the Docker image in production, only override in development. See [Plugin system](#plugin-system). | messaging,chat |
| USE_CORS                  | Enable Cross-Origin Resource Sharing (only for development purposes)                                                                         | false          |
| ENABLE_PUBLIC_API_SWAGGER | Enable Swagger documentation for public API (recommended only for development environments)                                                 | true           |

### Agent feature discovery

When connecting to other agents, VS-A tries to get information from them in order to know what capabilities they support and adapt the flow to it. For example, it can request for user's preferred language to send messages using their locale, or NFC reading capability, to ask users to tap NFC tags and read their content (or fall back to another method in case they don't support that).

VS-A fetches capabilities from the `discovery.json` file (which is located at at `/www/apps/vs-agent/discovery.json` in the deployed container) to determine available features. If you want to customize the capabilities to look for, replace the volume at this path with your own `discovery.json` file.

### eMRTD (ePassport) verification

The **eMRTD verification module** allows VS Agent to verify the authenticity and integrity of electronic Machine Readable Travel Documents (ePassports). When enabled, the agent will load CSCA (Country Signing Certification Authority) trust anchors from a **Master List** and verify the `EF.SOD` digital signature and data group hashes (for example, `DG1`, `DG2`).

#### Master List format and location

- **Format:** The Master List **must be in LDIF** format (`.ldif`). Other formats are not supported.
- **Location:** Provide the location via `MASTER_LIST_CSCA_LOCATION` using one of the following:
  - `https://...` — fetch over HTTPS on startup.
  - `file:///...` — local file through a file URL.
  - Absolute path — e.g., `/opt/icao/csca.ldif` inside the container/host.
- **Where to get it:** The official ICAO Master List can be downloaded from [https://pkddownloadsg.icao.int/](https://pkddownloadsg.icao.int/)

#### How it works

1. On startup, VS Agent checks the environment variable `MASTER_LIST_CSCA_LOCATION`.
2. If present, the agent parses the Master List and loads the CSCA certificates as trust anchors.
3. During verification, the agent validates the `EF.SOD` signature against the DS certificate chain anchored in the CSCA and verifies the integrity of the referenced Data Groups by recomputing and comparing the digests.
4. Verification results are made available to the internal flows of VS Agent (exact endpoints and payloads depend on your integration).

> **Important:**

- The Master List must be a valid `.ldif` file containing CSCA certificates. Make sure the file is present inside the running container or host environment and readable by the process user.

- If MASTER_LIST_CSCA_LOCATION is not set, the eMRTD Authenticity & Integrity Verification remains disabled and the agent only send EMrtd data parsed.

- For more information about authenticity & integrity verification, see: [credo-ts-didcomm-mrtd Authenticity & Integrity Verification](https://github.com/2060-io/credo-ts-didcomm-ext/blob/main/packages/mrtd/docs/mrtd-authenticity-integrity.md).

#### Enabling the module

Use the `vs-agent-mrtd` Docker image (it bundles `@verana-labs/vs-agent-plugin-mrtd`) and set the environment variable pointing to the Master List file:

```bash
# .env example
MASTER_LIST_CSCA_LOCATION=/opt/vs-agent/icao/ML_ICAO_2025-07-10.ldif
MASTER_LIST_CSCA_LOCATION=https://pkddownloadsg.icao.int/file?id=f6e328050fd481060e787569dd8e998c43f14230
```

## Plugin system

VS Agent uses an opt-in plugin architecture. Each plugin is an independent package that brings its own Credo modules, NestJS controllers, message handlers, and event listeners. Plugins are loaded dynamically at startup based on the `VS_AGENT_PLUGINS` environment variable, so only the required dependencies are pulled into the process.

### Available plugins

| Plugin      | Package                             | Description                                                                                   |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `messaging` | _(built-in)_                        | Base credential and proof handlers. Always loaded — cannot be disabled.                       |
| `chat`      | `@verana-labs/vs-agent-plugin-chat` | Chat protocols: text messages, media, reactions, receipts, calls, action menus, user profile. |
| `mrtd`      | `@verana-labs/vs-agent-plugin-mrtd` | eMRTD / ePassport verification. Requires the `vs-agent-mrtd` Docker image.                    |

### Selecting plugins

Set `VS_AGENT_PLUGINS` to a comma-separated list of the plugins you want active:

```bash
# Default: base messaging + chat
VS_AGENT_PLUGINS=messaging,chat

# Base only (no chat, no eMRTD)
VS_AGENT_PLUGINS=messaging

# All features
VS_AGENT_PLUGINS=messaging,chat,mrtd
```

> **Note:** `messaging` is always required and will be prepended automatically if omitted.
>
> In production, `VS_AGENT_PLUGINS` is pre-configured by the Docker image, override it only in development environments. Using a value that references a plugin not bundled in the current image will result in a startup warning and the plugin being skipped.

### Optional dependencies

`@verana-labs/vs-agent-plugin-chat` and `@verana-labs/vs-agent-plugin-mrtd` are declared as `optionalDependencies` in the Docker image. This makes it possible to build leaner images that only install the plugins you need:

```bash
# Install without mrtd plugin (no native binaries required)
pnpm install --no-optional
```

---

## Deploy and run

vs-agent can be run both locally or containerized.

### Locally

vs-agent can be built and run on localhost by just setting the corresponding variables and executing:

```bash
pnpm build
pnpm dev
```

Upon a successful start, the following lines should be read in log:

```bash
VS Agent running in port xxxx. Admin interface at port yyyy
```

This means that VS-A is up and running!

### Using docker

First

The Dockerfile produces two images of different sizes depending on which plugins are included. Choose the one that matches your needs:

| Target | Image | Plugins included |
|--------|-------|-----------------|
| `vs-agent` | `2060io/vs-agent` | messaging + chat |
| `vs-agent-mrtd` | `2060io/vs-agent-mrtd` | messaging + chat + mrtd |

#### Building locally

The build context must be the **monorepo root**, not the `apps/vs-agent` directory:

```bash
# From the repository root
docker build --target vs-agent      -t vs-agent      -f apps/vs-agent/Dockerfile .
docker build --target vs-agent-mrtd -t vs-agent-mrtd -f apps/vs-agent/Dockerfile .
```

#### Running a container

```bash
docker run \
  -e PUBLIC_API_BASE_URL=https://myagent.example.com \
  -e EVENTS_WEBHOOK_URL=http://my-backend:5000/events \
  -p 3000:3000 -p 3001:3001 \
  vs-agent
```

#### Using Docker Compose

When building the image as part of a Compose setup, set `context` to the repository root and specify the `target`:

```yaml
services:
  vs-agent:
    build:
      context: ../.. # repository root
      dockerfile: ./apps/vs-agent/Dockerfile
      target: vs-agent                        # choose the appropriate target (vs-agent or vs-agent-mrtd)
    environment:
      - PUBLIC_API_BASE_URL=https://myagent.example.com
      - EVENTS_WEBHOOK_URL=http://my-backend:5000/events
    ports:
      - 3000:3000
      - 3001:3001
    volumes:
      - ./afj:/root/.afj
```

## API

The Administration API is specified in the [VS Agent Specification, Verana v4](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#administration-api), and every event the agent emits in its [Events API](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#events-api). When the agent runs, the Swagger UI of the Admin API is available at the root of the admin port for trusted-network callers.

The [NestJS client](../../packages/nestjs-client/) and the [base client](../../packages/client/) implement the Administration API and the Events API for a backend.
