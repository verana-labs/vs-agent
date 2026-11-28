import { DidCommOutOfBandEventTypes, DidCommOutOfBandRole } from '@credo-ts/didcomm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { connectionEvents } from '../src/events/ConnectionEvents'

const queries = [{ featureType: 'protocol', match: 'https://didcomm.org/*' }]

const queryFeatures = vi.fn()
const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

async function reuse(discoveryOptions: typeof queries | undefined, role = DidCommOutOfBandRole.Sender) {
  const on = vi.fn()
  const agent = { events: { on }, didcomm: { discovery: { queryFeatures } } }
  await connectionEvents(agent as never, { discoveryOptions, logger: logger as never })

  const [, handler] = on.mock.calls.find(([type]) => type === DidCommOutOfBandEventTypes.HandshakeReused) as [
    string,
    (event: { payload: unknown }) => Promise<void>,
  ]
  await handler({
    payload: {
      reuseThreadId: 'reuse-1',
      connectionRecord: { id: 'conn-1' },
      outOfBandRecord: { id: 'oob-1', role },
    },
  })
}

describe('feature query after a handshake reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryFeatures.mockResolvedValue(undefined)
  })

  it('queries the peer that reuses its connection for an invitation of this agent', async () => {
    await reuse(queries)

    expect(queryFeatures).toHaveBeenCalledExactlyOnceWith({
      connectionId: 'conn-1',
      protocolVersion: 'v2',
      queries,
    })
  })

  it('sends no query without feature discovery', async () => {
    await reuse(undefined)

    expect(queryFeatures).not.toHaveBeenCalled()
  })

  it('sends no query when this agent is the one that reuses a connection', async () => {
    await reuse(queries, DidCommOutOfBandRole.Receiver)

    expect(queryFeatures).not.toHaveBeenCalled()
  })

  it('logs a query that fails and does not reject', async () => {
    queryFeatures.mockRejectedValue(new Error('no route to the peer'))

    await expect(reuse(queries)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no route to the peer'))
  })
})
