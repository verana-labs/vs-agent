# vt-flow demo: local v4 lifecycle environment

Two ways to exercise the full v4 flow against a real chain and indexer: an automated test for CI and regression, and a local demo environment for hands-on exploration.

## Automated e2e test

`apps/vs-agent/tests/e2e/fullLifecycle.e2e.test.ts` runs the whole lifecycle against a live verana-node and indexer started with testcontainers. It covers:

- ECS bootstrap and self-onboarding
- onboarding over DIDComm, on-chain validation, and session anchoring
- real JSON-LD issuance with digest verification on the indexer
- revocation with holder-side credential cleanup
- renewal reusing the same session
- cancel restoring the flow to `COMPLETED`
- a delegated child onboarding as a HOLDER of the parent's Service credential

Run it:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"   # colima only
export TESTCONTAINERS_RYUK_DISABLED=true
cd apps/vs-agent
pnpm test:e2e
```

Requires Docker and the `veranalabs/verana-node:v0.10.1` and `veranalabs/verana-indexer:dev` images. First run pulls them; the stack starts and stops per run.

## Local demo environment

Runs the same stack for manual use: verana chain, indexer, and three VS Agents (a validator, an applicant, and the ecosystem owner) behind a TLS proxy, so each agent gets a real `did:webvh` DID and they talk DIDComm v2 container-to-container.

### Start

```bash
cd examples/vt-flow-demo
cp .env.example .env
docker compose -f docker/docker-compose.yml --env-file .env up --build -d
```

All the demo commands below run from `examples/vt-flow-demo`, and every compose command needs `--env-file .env`: compose looks for its env file next to the compose file, which is `docker/`.

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
| Ecosystem admin API + Swagger | http://localhost:4200 (`/api`) |
| Ecosystem public API + UI | http://localhost:4201 |

### Seed the chain

The demo chain starts empty apart from the funded `cooluser` account. Once the three agents are up, seed the three corporations, the ecosystem, the ECS schemas, the root participants, and the operator grants. Until the seed runs, each agent logs that it cannot resolve its corporation and that it skipped its bootstrap; that is expected.

The seed creates three corporations, and each one holds a single role:

| Corporation | Holds | Operated by |
|---|---|---|
| Validator | the validator's participants | agent-validator |
| Ecosystem | the ecosystem, the ECS schemas and the root participants | agent-ecosystem |
| Applicant | the applicant's participants | agent-applicant |

The ecosystem needs a corporation of its own, operated by `agent-ecosystem`. That agent publishes the VTJSC for each schema, which is what lets the other two rebind their ECS credentials onto on-chain `vpr:verana:` references; without it their references stay self-issued https URLs and fail the VS-CONN-VS check. It signs nothing on chain, so it needs no funds and no `OperatorAuthorization`.

The validator and the applicant also need separate corporations from each other. A participant OP is unique per (schema, role, validator, authority), so one shared corporation makes the applicant's Service onboarding collide with the validator's.

The seed needs the validator's and applicant's operator addresses, which each agent derives from its mnemonic and prints at startup:

```bash
docker logs $(docker compose -f docker/docker-compose.yml --env-file .env ps -q agent-validator) 2>&1 | grep vs_operator
docker logs $(docker compose -f docker/docker-compose.yml --env-file .env ps -q agent-applicant) 2>&1 | grep vs_operator
```

The three agents must use distinct mnemonics, and none may reuse the `cooluser` mnemonic the seed itself signs with: the seed grants the validator a VSOA on its participant OP and the applicant an OperatorAuthorization, and the chain rejects an account that would end up holding both on one corporation. The defaults in `.env.example` already satisfy this.

Then run the seed with both addresses:

```bash
DEMO_VALIDATOR_OPERATOR=<validator operator address> \
  DEMO_APPLICANT_OPERATOR=<applicant operator address> \
  pnpm seed
```

The seed prints the three corporation ids, the ecosystem DID, the schema ids, and the validator participant ids. Copy the three `*CorporationId` values into `.env`, and the `ecosystemDid` into `TRUSTED_ECS_ECOSYSTEM_DIDS`, replacing the placeholder: it is a `did:webvh`, so it differs on every fresh volume. Then recreate the containers, because each agent reads the chain only at startup:

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d agent-ecosystem
docker compose -f docker/docker-compose.yml --env-file .env up -d
```

Use `up -d`, not `restart`: `restart` keeps the old environment, so the new `TRUSTED_ECS_ECOSYSTEM_DIDS` would not take effect. Bring up the ecosystem agent first and let it publish its VTJSCs; the other two rebind onto them at startup, and if they come up first they log `[SelfTR] Failed to rebind the ECS credential of schema <id>` and keep their self-issued references.

The applicant's ECS bootstrap then self-onboards and sends the onboarding request to the validator over DIDComm. That request is driven by a single indexer event and is never retried, so a failed first attempt needs a `down -v` and a fresh seed.

The applicant resolves as `not-trusted` at that point — it has not onboarded yet, so it holds no anchored credentials — and the validator logs the rejection:

```
[vt-flow] VS-CONN-VS rejected 'did:webvh:...:agent-applicant.demo': verified=true outcome=not-trusted
```

It accepts the request anyway, under the [VS-CONN-VS] ECS issuance exemption: the applicant owns a `PENDING` Participant entry that names the validator as its validator, on an ECS schema of the ecosystem in `TRUSTED_ECS_ECOSYSTEM_DIDS`. The flow lands in `AWAITING_OR` on the validator and `OR_SENT` on the applicant. The exemption is one-way: the applicant still requires the validator to resolve as `verified`, which is why the ecosystem agent has to publish its VTJSCs first.

### Drive the flow

Use each agent's Swagger (`/api` on the admin port). The flow surface is under `/v2/vt/flows`: list flows, edit claims, send OOB links, validate, and revoke.

The ECS Organization schema requires claims the applicant does not send, so set them before validating (`<sid>` is the flow's `participantSessionId`):

```bash
curl -X PUT http://localhost:4000/v2/vt/flows/<sid>/claims -H 'Content-Type: application/json' \
  -d '{"claims":{"name":"Applicant Demo Org","logoUri":"https://agent-applicant.demo/vt/default/logo.svg","logoDigestSri":"sha384-AAAA","registryId":"DEMO-1","address":"1 Demo Street","countryCode":"ES"}}'
curl -X POST http://localhost:4000/v2/vt/flows/<sid>/validate -H 'Content-Type: application/json' -d '{}'
```

Both sides then reach `COMPLETED` and the applicant's HOLDER participant goes `VALIDATED` / `ACTIVE` on chain.

### Known gaps

- The applicant's second bootstrap leg (an ISSUER participant on the Service schema) stays `PENDING`. Its validator is the ecosystem root participant, which the seed creates with a `did:example:` DID, so there is no DIDComm peer to onboard against.
- On completion the applicant logs `onCompleted failed: authorization check failed`: the seed grants it no authorization for the post-issuance on-chain call, so it never links the VP or triggers the resolver.
- Both agents log webhook errors for `http://localhost:5000`; the demo runs no backend.

The ECS Organization schema requires claims the applicant does not send, so set them before validating (`<sid>` is the flow's `participantSessionId`):

```bash
curl -X PUT http://localhost:4000/v1/vt/flows/<sid>/claims -H 'Content-Type: application/json' \
  -d '{"claims":{"name":"Applicant Demo Org","logoUri":"https://agent-applicant.demo/vt/default/logo.svg","logoDigestSri":"sha384-AAAA","registryId":"DEMO-1","address":"1 Demo Street","countryCode":"ES"}}'
curl -X POST http://localhost:4000/v1/vt/flows/<sid>/validate -H 'Content-Type: application/json' -d '{}'
```

Both sides then reach `COMPLETED` and the applicant's HOLDER participant goes `VALIDATED` / `ACTIVE` on chain.

### Known gaps

- The applicant's second bootstrap leg (an ISSUER participant on the Service schema) stays `PENDING`. Its validator is the ecosystem root participant, which the seed creates with a `did:example:` DID, so there is no DIDComm peer to onboard against.
- On completion the applicant logs `onCompleted failed: authorization check failed`: the seed grants it no authorization for the post-issuance on-chain call, so it never links the VP or triggers the resolver.
- Both agents log webhook errors for `http://localhost:5000`; the demo runs no backend.

### TLS and DIDs

A Caddy container with an internal CA terminates TLS for `agent-validator.demo`, `agent-applicant.demo` and `agent-ecosystem.demo` (network aliases on the compose network). Each agent boots with a real `did:webvh` DID on its hostname and trusts the CA via `NODE_EXTRA_CA_CERTS`, so the containers resolve each other's DID documents over HTTPS and DIDComm works container-to-container. The hostnames only resolve inside the compose network; from the host, use the mapped ports above.

Wallets persist in named volumes (`agent-validator-data`, `agent-applicant-data`, `agent-ecosystem-data`), so DIDs and credentials survive container recreation. Run `docker compose -f docker/docker-compose.yml --env-file .env down -v` to reset everything.
