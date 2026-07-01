# @verana-labs/vs-agent-sdk

Framework-agnostic Verifiable Service Agent SDK with DIDComm, AnonCreds, and blockchain integration.

## Install

```bash
npm install @verana-labs/vs-agent-sdk @credo-ts/core @credo-ts/node
```

## Basic Usage

```typescript
import { createVsAgent, setupBaseDidComm } from '@verana-labs/vs-agent-sdk'
import { getNodeHttpServer } from '@credo-ts/node'

const agent = createVsAgent({
  plugins: [
    setupBaseDidComm({
      walletConfig: { dbPath: './wallet' },
      publicApiBaseUrl: 'https://api.example.com',
      endpoints: ['https://agent.example.com/didcomm'],
    }),
  ],
  label: 'My Agent',
  publicApiBaseUrl: 'https://api.example.com',
  dependencies: getNodeHttpServer(),
})

await agent.initialize()
```

## Indexer WebSocket

Stream blockchain events in real-time:

```typescript
import { IndexerWebSocketService } from '@verana-labs/vs-agent-sdk'

const indexerWs = new IndexerWebSocketService({
  indexerUrl: 'https://indexer.verana.io',
  agent,
})

await indexerWs.start()
// Auto-reconnects with exponential backoff (max 5min)
// Persists last block height in agent storage
```

### Custom Handlers

A handler implements `IndexerEventHandler`: a `msg` (the indexer activity name it reacts to) and a
`handle(activity, ctx)` method. Register handlers on an `IndexerHandlerRegistry` and pass it to the
service via the `handlerRegistry` option. When no registry is provided, the service falls back to
`buildDefaultIndexerHandlerRegistry()`, so the default behavior is unchanged.

`register` stores handlers keyed by `msg`, so registering a handler for an existing `msg` **overrides**
the default one, and registering a new `msg` **adds** support for an event the default implementation
does not cover.

```typescript
import { buildDefaultIndexerHandlerRegistry } from '@verana-labs/vs-agent-sdk'

const handlerRegistry = buildDefaultIndexerHandlerRegistry()

const indexerWs = new IndexerWebSocketService({
  indexerUrl: 'https://indexer.example.com',
  agent,
  handlerRegistry,
})
```

**Override a default handler, or add one for an uncovered event:**

```typescript
import { buildDefaultIndexerHandlerRegistry } from '@verana-labs/vs-agent-sdk'
import type { IndexerActivity, IndexerHandlerContext } from '@verana-labs/vs-agent-sdk'

const registry = buildDefaultIndexerHandlerRegistry()

// Replace the default handler for a given msg with custom logic
registry.register({
  msg: 'UpdateCredentialSchema',
  handle: async (activity: IndexerActivity, ctx: IndexerHandlerContext) => {
    ctx.agent.config.logger.info(`Schema ${activity.entity_id} updated at block ${ctx.block_height}`)
    await db.schemas.update(activity.entity_id, activity.changes)
  },
})

// Add a handler for an event the default implementation does not cover
registry.register({
  msg: 'SomeCustomEvent',
  handle: async (activity, ctx) => {
    ctx.agent.config.logger.info(`Custom event ${activity.entity_id} at block ${ctx.block_height}`)
  },
})

const indexerWs = new IndexerWebSocketService({
  indexerUrl: 'https://indexer.example.com',
  agent,
  handlerRegistry: registry,
})
```

**Compose on top of a default handler** (run the default, then your own logic):

```typescript
const registry = buildDefaultIndexerHandlerRegistry()
const previous = registry.get('StartParticipantOP')

registry.register({
  msg: 'StartParticipantOP',
  handle: async (activity, ctx) => {
    await previous?.handle(activity, ctx)
    await myExtraSideEffect(activity, ctx)
  },
})

const indexerWs = new IndexerWebSocketService({
  indexerUrl: 'https://indexer.example.com',
  agent,
  handlerRegistry: registry,
})
```

## Blockchain Integration

```typescript
import { VeranaChainService } from '@verana-labs/vs-agent-sdk'

const chain = new VeranaChainService({
  rpcUrl: 'https://rpc.verana.io',
  chainId: 'verana-mainnet-1',
  mnemonic: 'your wallet seed phrase...',
  logger: agent.config.logger,
})

const agent = createVsAgent({
  plugins: [...],
  veranaChain: chain,
  label: 'My Agent',
  publicApiBaseUrl: 'https://api.example.com',
  dependencies: getNodeHttpServer(),
})
```

## Utilities

```typescript
// DIDs
import { createInvitation, getWebDid } from '@verana-labs/vs-agent-sdk'

const did = await getWebDid(agent)
const invitation = await createInvitation(agent)

// Transports
import {
  HttpInboundTransport,
  VsAgentWsInboundTransport,
} from '@verana-labs/vs-agent-sdk'
```
