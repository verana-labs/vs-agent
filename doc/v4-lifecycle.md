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

Requires Docker and the `veranalabs/verana-node:v0.10.1` and `veranalabs/verana-indexer:dev` images. First run pulls them; the stack starts and stops per run.

## Local demo environment

Runs the same stack for manual use: verana chain, indexer, and two VS Agents (a validator and an applicant) behind a TLS proxy, so each agent gets a real `did:webvh` DID and they talk DIDComm v2 container-to-container.

### Start

```bash
cd apps/vs-agent/examples/vt-flow-demo
cp .env.example .env
docker compose --env-file .env up --build -d
```

All the demo commands below run from `apps/vs-agent/examples/vt-flow-demo`.

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

The demo chain starts empty apart from the funded `cooluser` account. Once both agents are up, seed the three corporations, the ecosystem, the ECS schemas, the root participants, and the operator grants. Until the seed runs, each agent logs that it cannot resolve its corporation and that it skipped its bootstrap; that is expected.

The seed creates three corporations, and each one holds a single role:

| Corporation | Holds |
|---|---|
| Validator | the validator's participants |
| Ecosystem | the ecosystem, the ECS schemas and the root participants |
| Applicant | the applicant's participants |

The ecosystem needs a corporation of its own, and no agent operates for it. An agent publishes a VTJSC for every schema its own corporation owns, and such a credential references the schema on chain. Both agents here present self-issued credentials that must reference only their own URLs, so neither may own a schema.

The validator and the applicant also need separate corporations from each other. A participant OP is unique per (schema, role, validator, authority), so one shared corporation makes the applicant's Service onboarding collide with the validator's.

The seed needs both agents' operator addresses, which each agent derives from its mnemonic and prints at startup:

```bash
docker logs $(docker compose ps -q agent-validator) 2>&1 | grep vs_operator
docker logs $(docker compose ps -q agent-applicant) 2>&1 | grep vs_operator
```

The two agents must use distinct mnemonics, and neither may reuse the `cooluser` mnemonic the seed itself signs with: the seed grants the validator a VSOA on its participant OP and the applicant an OperatorAuthorization, and the chain rejects an account that would end up holding both on one corporation. The defaults in `.env.example` already satisfy this.

Then run the seed with both addresses:

```bash
cd apps/vs-agent
DEMO_VALIDATOR_OPERATOR=<validator operator address> \
  DEMO_APPLICANT_OPERATOR=<applicant operator address> \
  pnpm demo:seed
```

The seed prints the three corporation ids, the ecosystem DID, the schema ids, and the validator participant ids. Only `validatorCorporationId` and `applicantCorporationId` go into `.env`; no agent uses the ecosystem corporation. A fresh chain produces the ids that `.env.example` already carries, so confirm them against that output and correct `.env` if they differ. Then restart both agents, because each agent reads the chain only at startup:

```bash
docker compose --env-file .env restart agent-validator agent-applicant
```

Use `restart` here, not `up -d`. Compose recreates a container only when its configuration changes, and `.env` already holds the seeded values.

The applicant's ECS bootstrap self-onboards and sends the onboarding request to the validator over DIDComm.

### Drive the flow

Use each agent's Swagger (`/api` on the admin port). The flow surface is under `/v1/vt/flows`: list flows, edit claims, send OOB links, validate, and revoke.

### TLS and DIDs

A Caddy container with an internal CA terminates TLS for `agent-validator.demo` and `agent-applicant.demo` (network aliases on the compose network). Each agent boots with a real `did:webvh` DID on its hostname and trusts the CA via `NODE_EXTRA_CA_CERTS`, so the containers resolve each other's DID documents over HTTPS and DIDComm works container-to-container. The hostnames only resolve inside the compose network; from the host, use the mapped ports above.

Wallets persist in named volumes (`agent-validator-data`, `agent-applicant-data`), so DIDs and credentials survive container recreation. Run `docker compose down -v` to reset everything.
