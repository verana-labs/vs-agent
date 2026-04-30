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

Build default handlers or replace with your own:

```typescript
import { buildDefaultIndexerHandlerRegistry } from '@verana-labs/vs-agent-sdk'

const handlerRegistry = buildDefaultIndexerHandlerRegistry()

const indexerWs = new IndexerWebSocketService({
  indexerUrl: 'https://indexer.example.com',
  agent,
  handlerRegistry,
})
```

**Override a specific handler:**

```typescript
import { buildDefaultIndexerHandlerRegistry } from '@verana-labs/vs-agent-sdk'
import type { IndexerActivity, IndexerDispatchContext } from '@verana-labs/vs-agent-sdk'

const registry = buildDefaultIndexerHandlerRegistry()

// Replace credential schema handler with custom logic
registry.register('CredentialSchema', async (activity: IndexerActivity, context: IndexerDispatchContext) => {
  const { id, jsonSchema } = activity.changes as any
  console.log(`Schema ${id} updated at block ${context.blockHeight}`)
  
  // Sync to your database
  await db.schemas.update(id, { schema: jsonSchema })
})

const indexerWs = new IndexerWebSocketService({
  indexerUrl: 'https://indexer.example.com',
  agent,
  handlerRegistry: registry,
})
```

**Custom handlers from scratch:**

```typescript
import { IndexerHandlerRegistry } from '@verana-labs/vs-agent-sdk'
import type { IndexerActivity, IndexerDispatchContext } from '@verana-labs/vs-agent-sdk'

const registry = new IndexerHandlerRegistry()

// Handle trust registry changes
registry.register('TrustRegistry', async (activity, context) => {
  const { id, did, archived } = activity.changes as any
  await agent.config.logger.info(`[Block ${context.blockHeight}] TR ${id} ${archived ? 'archived' : 'activated'}`)
})

// Handle permission changes with custom messages
registry.register('Permission', async (activity, context) => {
  const { id, did, revoked } = activity.changes as any
  const status = revoked ? 'revoked' : 'granted'
  
  await agent.config.logger.info(`[Block ${context.blockHeight}] Permission ${status}: ${id}`)
  
  // Emit to your service
  await sendWebhookEvent('https://your-service.com/perms', {
    type: 'permission_status_changed',
    permissionId: id,
    did,
    status,
    blockHeight: context.blockHeight,
    timestamp: new Date().toISOString(),
  })
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

// Webhooks
import { sendWebhookEvent } from '@verana-labs/vs-agent-sdk'

await sendWebhookEvent('https://example.com/webhook', {
  type: 'event_type',
  data: { /* ... */ },
})

// Transports
import {
  HttpInboundTransport,
  VsAgentWsInboundTransport,
} from '@verana-labs/vs-agent-sdk'
```
