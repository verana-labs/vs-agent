# @verana-labs/vs-agent-ui

Static dashboard UI for [vs-agent](../vs-agent). Built with React + Vite, served directly by the vs-agent HTTP server.

vs-agent-ui provides a lightweight read-only web interface to monitor a vs-agent node within the [Verana](https://verana.io) ecosystem — a decentralized trust infrastructure built on top of DIDComm and Verifiable Credentials.

## Dashboard

- Agent name, public DID, and QR code to connect.
- Linked Credentials (`vpr*-c-vp` services) grouped by ECS type.
- Schema Credentials (`vpr*-jsc-vp` services) grouped by ECS type.

Click any credential card to see the full JSON.

## Environment variables

Configured in vs-agent, injected into the UI at runtime.

| Variable | Default |
|---|---|
| `AGENT_LABEL` | `Test VS Agent` |
| `AGENT_WELCOME_MESSAGE` | `Welcome to VS Agent` |

## Development

```bash
pnpm build          # outputs to ../vs-agent/public
pnpm build:watch    # watch mode
```
