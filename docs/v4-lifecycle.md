# v4 lifecycle: e2e test and local demo

Two ways to exercise the full v4 flow against a real chain and indexer: an automated test for CI and regression, and a local demo environment for hands-on exploration.

## Automated e2e test

`apps/vs-agent/tests/e2e/fullLifecycle.e2e.test.ts` runs the whole lifecycle against a live verana-node and indexer started with testcontainers. It covers:

- ECS bootstrap and self-onboarding
- onboarding over DIDComm, on-chain validation, and session anchoring
- real JSON-LD issuance with digest verification on the indexer
- revocation with holder-side credential cleanup
- renewal reusing the same session
- cancel restoring the flow to `COMPLETED`
- a delegated child receiving its Service credential via Direct Issuance

Run it:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"   # colima only
export TESTCONTAINERS_RYUK_DISABLED=true
cd apps/vs-agent
pnpm test:e2e
```

Requires Docker and the `veranalabs/verana-node:v0.10.1-dev.25` and `veranalabs/verana-indexer:dev` images. First run pulls them; the stack starts and stops per run.

## Local demo environment

Runs the same stack for manual use: verana chain, indexer, and two VS Agents (a validator and an applicant) behind a TLS proxy, so each agent gets a real `did:webvh` DID and they talk DIDComm v2 container-to-container.

### Start

```bash
cp .env.demo.example .env
docker compose -f docker-compose.demo.yml --env-file .env up --build -d
```

Endpoints once healthy:

| Service | URL |
|---|---|
| Chain RPC | http://localhost:26658 |
| Chain LCD | http://localhost:1318 |
| Indexer REST + WS | http://localhost:3011 (`/v4/...`, WS `/v4/indexer/subscribe`) |
| Validator admin API + Swagger | http://localhost:4000 (`/api`) |
| Validator public API + UI | http://localhost:4001 |
| Applicant admin API + Swagger | http://localhost:4100 (`/api`) |
| Applicant public API + UI | http://localhost:4101 |

### Seed the chain

The demo chain starts empty apart from the funded `cooluser` account. Once both agents are up, seed the corporation, ecosystem, ECS schemas, root participants, and the validator grant. The seed needs the validator's operator address, which the agent prints at startup:

```bash
docker logs $(docker compose -f docker-compose.demo.yml ps -q agent-validator) 2>&1 | grep vs_operator
```

Then run the seed with that address:

```bash
cd apps/vs-agent
SEED_DEMO=1 DEMO_VALIDATOR_OPERATOR=<validator operator address> \
  pnpm exec vitest run tests/e2e/demoSeed.e2e.test.ts
```

The seed prints the corporation id, ecosystem DID, schema ids, and validator participant id. Put the ecosystem DID in `TRUSTED_ECS_ECOSYSTEM_DIDS` and the corporation id in `APPLICANT_CORPORATION_ID` in `.env`, then restart the applicant:

```bash
docker compose -f docker-compose.demo.yml --env-file .env up -d agent-applicant
```

Its ECS bootstrap self-onboards and sends the onboarding request to the validator over DIDComm.

### Drive the flow

Use each agent's Swagger (`/api` on the admin port). The flow surface is under `/v1/vt/flows`: list flows, edit claims, send OOB links, validate, and revoke.

### TLS and DIDs

A Caddy container with an internal CA terminates TLS for `agent-validator.demo` and `agent-applicant.demo` (network aliases on the compose network). Each agent boots with a real `did:webvh` DID on its hostname and trusts the CA via `NODE_EXTRA_CA_CERTS`, so the containers resolve each other's DID documents over HTTPS and DIDComm works container-to-container. The hostnames only resolve inside the compose network; from the host, use the mapped ports above.

Wallets persist in named volumes (`agent-validator-data`, `agent-applicant-data`), so DIDs and credentials survive container recreation. Run `docker compose -f docker-compose.demo.yml down -v` to reset everything.
