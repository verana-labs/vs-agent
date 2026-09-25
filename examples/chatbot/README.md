# Chatbot Example

An Express backend that drives a VS Agent through `@verana-labs/vs-agent-client`. It answers chat commands, sends menus, questions, media, calls and MRTD requests, and can issue and verify a `phoneNumber` AnonCreds credential.

## Running

```bash
cd examples/chatbot
docker-compose up --build
```

Set `PUBLIC_API_BASE_URL` in `docker-compose.yml` to the public `https` URL that fronts port `3001`. The agent derives its DID and its DIDComm endpoint from it. Then connect your wallet (for example Hologram) to the agent's public DID. There is no invitation endpoint. When the connection completes the bot sends its context menu and a welcome message.

Services:

- VS Agent, admin API on `3000`, public API on `3001`
- Chatbot backend on `5000`, receives the [Events API](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#events-api) webhook at `POST /events`

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Port of the backend |
| `VS_AGENT_ADMIN_BASE_URL` | `http://localhost:3000` | Admin API origin, the client appends `/v2` |
| `PUBLIC_BASE_URL` | `http://localhost:5000` | Public URL of the backend, used for the media sample and the call callbacks |
| `CREDENTIAL_DEFINITION_ID` | unset | AnonCreds credential definition with a `phoneNumber` attribute. Unset disables `issue`, `proof` and `/revoke` |
| `VISION_SERVICE_BASE_URL`, `WEBRTC_SERVER_BASE_URL` | 2060 dev services | Used by `/call` |

## Credentials

`issue`, `proof` and `/revoke` need an agent enrolled on a Verana ecosystem: `createCredentialOffer` and `createPresentationRequest` require an active ISSUER or VERIFIER Participant for the credential schema behind `CREDENTIAL_DEFINITION_ID`. See [examples/vt-flow-demo](../vt-flow-demo/README.md) for the setup. On startup the bot picks the first revocation registry of the definition or creates one.

Both methods return an out of band invitation. The bot sends its `shortUrl` to the chat and the wallet opens it, which creates a second connection for the exchange. The bot keeps the chat connection per exchange id so the result lands in the chat the user typed in.

## Commands

Menu options: Home, World Cup poll, Rocky quotes, Issue credential, Request proof, Help.

| Command | What it does |
|---|---|
| `/echo <text>` | Repeats the text |
| `/menu` | Sends the main menu as a question |
| `/context` | Resends the context menu |
| `/link <url> [title] [desc] [icon] [openingMode]` | Shares a link |
| `/media [url] [desc]` | Shares an image, `bunny.jpeg` by default |
| `/invitation [label] [imageUrl] [did]` | Sends an invitation on the chat connection. Without `did` it opens a sub-connection to the bot, with `did` it refers the wallet to that service |
| `/profile [name] [image] [icon]` | Sends the bot profile |
| `/call [wsUrl] [roomId]` | Offers a call, creating a WebRTC room when no arguments are given |
| `/mrz` | Requests the MRZ of a passport. When the wallet answers, the bot requests the eMRTD data. The eMRTD request is not threaded under the MRZ exchange, the v2 API has no parent thread field |
| `/emrtd` | Requests the eMRTD data directly |
| `/proof` | Requests a `phoneNumber` presentation |
| `/revoke <credentialExchangeId>` | Revokes the credential, the id is the one the bot sends after issuance. The wallet gets no notification |
| `/rocky` | An inspiring quote |
| `/help` | The command list |
| `/terminate` | Deletes the connection record on the agent. No hangup is sent |

Not ported from v1: the `viewed` receipt after every inbound message (the basic message event carries no DIDComm message id).

## Files

- `index.ts`: the Express app, the event handlers and the command dispatch
- `data.ts`: `welcomeMessage`, `helpMessage`, `rootContextMenu`, `rootMenuAsQA`, `worldCupPoll`, `rockyQuotes`
- `public/`: static files served by the backend
