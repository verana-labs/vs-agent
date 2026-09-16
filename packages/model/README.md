`@verana-labs/vs-agent-model`

# VS Agent Model

Shared types for [VS Agent](../../apps/vs-agent/README.md), the SDK and the DIDComm plugins: the legacy message classes and event payloads the agent emits in process, plus `StatEnum` and `StatEvent` used by the [NestJS client](../nestjs-client/README.md) stats producer. The [API client](../client/README.md) does not depend on this package.

## Installation

```sh
pnpm add @verana-labs/vs-agent-model
```

## Example

```ts
import { CallOfferRequestMessage } from '@verana-labs/vs-agent-model'

const callOffer = new CallOfferRequestMessage({
  connectionId: 'connectionId',
  description: 'Start call',
  parameters: { wsUrl, roomId, peerId },
})
```
