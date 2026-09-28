# Verifier Example

An Express backend on port `5100` that asks a VS Agent for a proof request and logs the presentation the wallet sends back. It uses `@verana-labs/vs-agent-client`.

## Running

```bash
cd examples/verifier
docker-compose up --build
```

Set `PUBLIC_API_BASE_URL` in `docker-compose.yml` to the public `https` URL that fronts port `3001`. The agent derives its DID and its `wss://` DIDComm endpoint from it, so a wallet cannot reach an agent published under a plain `http` URL. Set `CREDENTIAL_DEFINITION_ID` to the AnonCreds credential definition the wallet holds a credential for (the chatbot example issues one).

The agent needs an active VERIFIER Participant for the credential schema behind that definition on a Verana ecosystem, `createPresentationRequest` refuses the call otherwise. See [examples/vt-flow-demo](../vt-flow-demo/README.md) for the setup.

## Flow

1. `GET http://localhost:5100/invitation/<ref>` calls `createPresentationRequest` for `CREDENTIAL_DEFINITION_ID` and returns `{ proofExchangeId, invitation, shortUrl }`. The backend remembers `ref` per `proofExchangeId`.
2. Open `shortUrl` in the wallet. The wallet connects to the agent and presents the credential.
3. The agent posts `didcomm.presentations.state-updated` to `POST /events`. The backend logs `state`, `verified`, `claims` and the `ref`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5100` | Port of the backend |
| `VS_AGENT_ADMIN_BASE_URL` | `http://localhost:3000` | Admin API origin, the client appends `/v2` |
| `CREDENTIAL_DEFINITION_ID` | unset | Credential definition to request. Unset answers `503` on `/invitation/:ref` |
