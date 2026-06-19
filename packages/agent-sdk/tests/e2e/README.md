# Verana blockchain e2e

Integration tests that boot the real stack (verana-node + postgres + redis + indexer) with
testcontainers, drive the chain with CosmJS, and assert the resulting events arrive over the
indexer WebSocket.

## Run

```bash
pnpm test:e2e            # from the repo root (filters this package)
```

Requires Docker and the ability to pull `veranalabs/verana-node` / `veranalabs/verana-indexer`.
Without `RUN_FLOW_E2E=1` the suite is skipped, so plain `pnpm test` is unaffected.

## Files

- `verana-flow.test.ts` — the tests only. The stack is expensive, so it boots once in `beforeAll`
  and every assertion shares it. **Keep all integration tests here, don't add more e2e files.**
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
in `src/blockchain/VeranaChainService.ts`. Once verana-types is bumped to dev.16 (single version,
dropping the `-next` alias + `require()`), these commands should live in the SDK and the test should
just call them — delete `VeranaTestChain.ts` then.
