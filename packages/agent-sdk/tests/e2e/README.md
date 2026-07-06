# Verana blockchain e2e

Integration tests that boot the real stack (verana-node + postgres + redis + indexer) with
testcontainers, drive the chain with CosmJS, and assert the resulting chain queries, indexer REST
responses, and indexer WebSocket events. The stack starts and stops automatically, there is no
manual node, docker-compose, genesis, port, or funding setup.

## Prerequisites

- **Docker running** (Docker Desktop, or Colima / Rancher / Podman configured for testcontainers).
  testcontainers talks to the Docker daemon, that is the only hard dependency besides Node.
- **`pnpm install`** at the repo root.
- **`RUN_FLOW_E2E=1`** to un-skip the suite, without it every e2e `describe` is skipped (so plain
  `pnpm test` is unaffected).
- The images are **public** on Docker Hub (`veranalabs/verana-node`, `veranalabs/verana-indexer`),
  no `docker login` needed. The first run pulls them (a few hundred MB).
- **Apple Silicon (arm64):** the verana images are amd64-only, so set
  `DOCKER_DEFAULT_PLATFORM=linux/amd64` (emulation, slower). On Linux/amd64 it runs native, no flag.
- A few GB of RAM/disk for the four containers.

## Run

```bash
# Linux / amd64
RUN_FLOW_E2E=1 pnpm --filter @verana-labs/vs-agent-sdk exec vitest run tests/e2e

# Apple Silicon
RUN_FLOW_E2E=1 DOCKER_DEFAULT_PLATFORM=linux/amd64 pnpm --filter @verana-labs/vs-agent-sdk exec vitest run tests/e2e

# a single file (faster, one stack):
RUN_FLOW_E2E=1 pnpm --filter @verana-labs/vs-agent-sdk exec vitest run tests/e2e/onboarding.e2e.test.ts
```

Expect ~2-4 min per file on amd64, longer under emulation.

## Files

Each test file boots its **own** stack in `beforeAll` and shares it across that file's assertions.
Booting is expensive, so prefer adding to an existing file's stack over creating a new file.

- `verana-flow.test.ts` — corporation + ecosystem over the chain, asserted via the indexer
  WebSocket (`v4/indexer/subscribe`).
- `onboarding.e2e.test.ts` — the V4 onboarding flow: validation via an OA operator, `0/0` session
  via a separate VSOA account, and the HOLDER Path-1 `TriggerResolver`, asserting the on-chain
  participant and the indexer REST participant fields.
- `applicant-ops.e2e.test.ts` — the applicant-side tx surface (`startParticipantOP`, renew, cancel,
  self-create), the chain query surface, the single-account VSOA path (validate + session under one
  `vs_operator`), and the indexer event_type strings.
- `corp-scope.e2e.test.ts` — corporation-scoped WS subscribe + REST catch-up with v4 payloads.
- `helpers.ts` — infra: config, node bootstrap, `startStack()`, `IndexerSubscriber`, `sameTx`.
- `VeranaTestChain.ts` — throwaway CosmJS driver (see TODO below).

## Adding a chain command

Add a method to `VeranaTestChain` that builds the protobuf message and broadcasts it. The message
types and `typeUrl`s come from `@verana-labs/verana-types`:

```ts
const msg = {
  typeUrl: veranaTypeUrls.MsgCreateEcosystem,
  value: MsgCreateEcosystem.fromPartial({ corporation, operator: this.address, did, /* ... */ }),
}
const res = await this.broadcast([msg])
const { ecosystemId } = MsgCreateEcosystemResponse.decode(res.msgResponses[0].value)
return { ecosystemId, txHash: res.transactionHash }
```

Decode the `Msg...Response` to get ids back (no event parsing). Return `txHash` so the test can
correlate it with the WebSocket event.

## Adding a test

Use the shared `chain` and `subscriber`, then correlate the on-chain action with the streamed
event by tx hash:

```ts
const { txHash } = await chain.createEcosystem(policyAddress, { did })
const event = await subscriber.waitForEvent(sameTx(txHash), EVENT_TIMEOUT_MS)
expect(event.payload.message_type).toContain('MsgCreateEcosystem')
```

## TODO — move this into the SDK

`VeranaTestChain.ts` is scaffolding. The SDK already signs Verana txs with `@verana-labs/verana-types`
in `src/blockchain/VeranaChainService.ts`. These commands should live in the SDK and the test should
just call them, delete `VeranaTestChain.ts` then.
