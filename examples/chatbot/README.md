# Chatbot Example

An Express backend that drives a VS Agent through `@verana-labs/vs-agent-client`. It answers chat commands, sends menus, questions, media, calls and MRTD requests, and can issue and verify a `phoneNumber` AnonCreds credential.

## Running

```bash
cd examples/chatbot
docker-compose up --build
```

Set `PUBLIC_API_BASE_URL` in `docker-compose.yml` to the public `https` URL that fronts port `3001`. The agent derives its DID and its DIDComm endpoint from it. Then connect your wallet (for example Hologram) to the agent's public DID, or get an invitation from `GET /invitation` on the backend and scan its `url` as a QR code. When the connection completes the bot sends its context menu and a welcome message.

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

## Endpoints

All endpoints are on `PORT`.

| Endpoint | What it answers |
|---|---|
| `POST /events` | The [Events API](https://github.com/verana-labs/verana-spec/blob/main/v4/vs-agent/spec.md#events-api) webhook of the agent. `204` |
| `GET /invitation` | A new single use invitation: `{ "url": "<short URL of the invitation>", "invitationId": "<id>" }`. Scan the `url` as a QR code or open it with a wallet. The optional `label` query parameter, for example the id of a CI run, only goes to the log line of the request: the invitation carries no label. `503` with `{ "error": "..." }` when the admin API cannot create it |
| `GET /qr` | An HTML page with the QR code of a new invitation, as an inline SVG, for a manual test. The page also shows the URL of the invitation as text, and a link that gets another one. The invitation is reusable, so any number of wallets can scan the code. `503` with an HTML page when the admin API cannot create it |
| `GET /health` | `200` with `{ "status": "ok", "chatbotVersion": "...", "vsAgentVersion": "..." }` when the admin API is ready. `503` with `{ "status": "error", "chatbotVersion": "...", "reason": "..." }` when it is not ready or not reachable |

## Credentials

`issue`, `proof` and `/revoke` need an agent enrolled on a Verana ecosystem: `createCredentialOffer` and `createPresentationRequest` require an active ISSUER or VERIFIER Participant for the credential schema behind `CREDENTIAL_DEFINITION_ID`. See [examples/vt-flow-demo](../vt-flow-demo/README.md) for the setup. On startup the bot picks the first revocation registry of the definition or creates one.

Both methods take the `connectionId` of the chat, so the offer and the request go out on that connection and the wallet shows them in the same conversation. The bot sends no link, and the exchange needs no second connection. The bot still keeps the chat connection per exchange id, because an event carries the exchange id.

Omit `connectionId` and each method answers an out of band invitation instead, with a `shortUrl` for a QR code. That form suits a web page, where no connection exists yet.

## Commands

Menu options: Home, World Cup poll, Rocky quotes, Issue credential, Request proof, Help.

| Command | What it does |
|---|---|
| `/echo <text>` | Repeats the text |
| `/echo-media on\|off` | Shares back each media item that the wallet sends, off by default. See [Media](#media) |
| `/trace on\|off` | Sends one text for each action of the wallet, off by default. See [Trace](#trace) |
| `/menu` | Sends the main menu as a question |
| `/question [n]` | Sends the question `Test question` with the options `Option 1` to `Option n`, `n` from 1 to 10, 3 by default. The answer does not enter the menu logic, so the options need no handler |
| `/context` | Resends the context menu |
| `/link <url> [title] [desc] [icon] [openingMode]` | Shares a link |
| `/media image\|video\|audio\|file` | Shares the sample file of that type from `public/` |
| `/media [url] [desc]` | Shares an image that is already published, `bunny.jpeg` by default |
| `/invitation [label] [imageUrl] [did]` | Sends an invitation on the chat connection. Without `did` it opens a sub-connection to the bot, with `did` it refers the wallet to that service |
| `/invitation did=<did> label=<label> image=<url>` | The same, with named arguments in any order. One argument of the form `did=`, `label=` or `image=` selects this form, and the bot then ignores every other token. A command with no such token keeps the positional form |
| `/profile [name] [image] [icon]` | Sends the bot profile |
| `/call [wsUrl] [roomId]` | Offers a call, creating a WebRTC room when no arguments are given |
| `/mrz` | Requests the MRZ of a passport. When the wallet answers, the bot requests the eMRTD data. The eMRTD request is not threaded under the MRZ exchange, the v2 API has no parent thread field |
| `/emrtd` | Requests the eMRTD data directly |
| `/issue [phoneNumber]` | Offers a `phoneNumber` credential on the chat connection, the same as the `issue` menu option. The claim takes the argument, or `+5712345678` |
| `/proof` | Requests a `phoneNumber` presentation |
| `/revoke <credentialExchangeId>` | Revokes the credential, the id is the one the bot sends after issuance. The wallet gets no notification |
| `/rocky` | An inspiring quote |
| `/help` | The command list |
| `/terminate` | Tells the wallet that the connection ends, then deletes the connection record on the agent |

Not ported from v1: the `viewed` receipt after every inbound message (the basic message event carries no DIDComm message id).

### Media

For each media item that the wallet shares, the bot downloads it, deciphers it when the item carries a `ciphering`, and answers one text `media-received <mimeType> <byteCount> sha256:<digest>` of the plain bytes. A download or a decipher that fails answers `media-error <reason>` instead. With `/echo-media on` the bot also shares the item back, with the same `uri`, `ciphering` and `metadata`.

### Trace

`/trace on` makes the bot answer one text for each action that the wallet sends on that connection:

| Event | Text |
|---|---|
| `didcomm.receipts.message-receipts-received` | `receipt <state> <messageId>`, one text for each receipt |
| `didcomm.reactions.message-reactions-received` | `reaction <action> <emoji> <messageId>`, one text for each reaction |
| `didcomm.user-profile.profile-received` | `profile <displayName>` |
| `didcomm.action-menu.perform-received` | `menu <name>` |
| `didcomm.question-answer.answer-received` | `answer <response>` |

The texts add to the behavior of the bot and do not replace it: the bot still answers ❤️ to a reaction, and still acts on a menu selection and on an answer of its own questions.

A trace text is a message too, so the wallet sends a receipt for it. To break that loop the bot keeps the `id` that `sendBasicMessage` answers for each trace text, which is the id of the sent message, and sends no trace for a receipt of those messages. The bot keeps the last 200 of them, which bounds the memory and covers the receipts of a conversation: a wallet reports `received` and `viewed` soon after it gets the message.

## Files

- `index.ts`: the Express app, the event handlers and the command dispatch
- `data.ts`: `welcomeMessage`, `helpMessage`, `mediaFixtures`, `rootContextMenu`, `rootMenuAsQA`, `testQuestion`, `worldCupPoll`, `rockyQuotes`
- `public/`: static files served by the backend
