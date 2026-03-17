# @verana-labs/vs-agent-ui

Static dashboard UI for [vs-agent](../vs-agent). Built with React + Vite, served directly by the vs-agent HTTP server.

vs-agent-ui provides a lightweight web interface to configure and operate a vs-agent node within the [Verana](https://verana.io) ecosystem — a decentralized trust infrastructure built on top of DIDComm and Verifiable Credentials.

Through this dashboard, operators can:

- **Inspect the agent** — view the agent's DID, label, and health status.
- **Manage connections** — monitor active DIDComm connections with other agents or wallets.
- **Configure verifiable credentials** — create, update, and delete Linked Verifiable Credentials (organization, service, persona, user agent) that the agent presents to the Verana trust registry.
- **Invite new peers** — display the agent's QR code so external wallets or agents can initiate a DIDComm connection.

The goal is to eliminate the need for direct API calls or CLI tools during initial setup and day-to-day operation of a vs-agent node.

## How it works

- The UI is a plain React SPA (no framework, no Tailwind — just CSS + fetch).
- `vite build` compiles everything into `apps/vs-agent/public/`.
- vs-agent serves that folder via `express.static` on the public port.
- The UI calls the vs-agent admin API at the same origin (e.g. `/v1/agent/`, `/v1/connections/`, `/v1/vt/linked-credentials`, `/v1/qr/`).

## Development

From the monorepo root:

```bash
# one-shot build
pnpm ui build

# start vs-agent + UI in watch mode (rebuilds UI on file changes)
pnpm start:dev
```

Or from this package directly:

```bash
pnpm build          # single build → outputs to ../vs-agent/public
pnpm build:watch    # watch mode
```
