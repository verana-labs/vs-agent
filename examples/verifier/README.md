# Verifier Example

## Overview

This example shows how to request and verify a Verifiable Credential presentation from a connected user. It covers:

- Sending a proof request
- Validating the received credential
- Handling success or failure flows

## Prerequisites

- Docker & Docker Compose
- A credential already stored in your wallet (issue via the Chatbot example)

## Installation

```bash
cd vs-agent/examples/verifier
```

## Running Locally

1. Start services:

   ```bash
   docker-compose up --build
   ```

2. Services:
   - VS Agent → port `3001`
   - Verifier backend → port `5000`
3. Obtain connection via:
   - Web: `http://localhost:3001/invitation`
   - QR: `http://localhost:3001/invitation/qr`

   Set `PUBLIC_API_BASE_URL` in `docker-compose.yml` to the public `https` URL that fronts port 3001. The agent derives its DID and its `wss://` DIDComm endpoint from it, so a wallet cannot reach an agent published under a plain `http` URL.
4. Scan QR in your wallet and accept.

## Flow Diagram

```mermaid
sequenceDiagram
    actor User as DIDComm Wallet
    participant Agent as VS Agent
    participant Verifier as Verifier Service

    User ->> Agent: Scan QR (invitation/qr)
    Agent ->> User: Send invitation
    User ->> Agent: Establish connection
    Agent ->> Verifier: Forward connection event
    Verifier ->> Agent: Send proof request
    Agent ->> User: Deliver presentation request
    User ->> Agent: Present credential
    Agent ->> Verifier: Forward presentation
    Verifier ->> Agent: Send verification result
    Agent ->> User: Deliver result
```

## Usage

- Upon connection, the Verifier sends a proof request for the credential.
- Approve the presentation in your wallet.
- Wallet shows verification result (✅ or ❌).

## Configuration

- Modify requested credential type in `src/index.ts`.
- Adjust ports or URLs in `docker-compose.yml`.

## Troubleshooting

- If you lack the requested credential, run the Chatbot example first.
- View logs: `docker-compose logs verifier`.
