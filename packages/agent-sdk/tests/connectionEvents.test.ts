import {
  DidCommConnectionEventTypes,
  DidCommConnectionService,
  DidCommDidExchangeState,
} from '@credo-ts/didcomm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { connectionEvents } from '../src/events/ConnectionEvents'
import { VsAgentEventTypes } from '../src/events/VsAgentEvents'

const connectionService = { updateState: vi.fn() }
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const on = vi.fn()
const emit = vi.fn()

const agent = {
  context: {
    dependencyManager: {
      resolve: (token: unknown) => (token === DidCommConnectionService ? connectionService : undefined),
    },
  },
  events: { on, emit },
}

const didRotated = (connectionRecord: Record<string, unknown>) => {
  const [, listener] = on.mock.calls.find(
    ([type]) => type === DidCommConnectionEventTypes.DidCommConnectionDidRotated,
  ) as [string, (event: { payload: unknown }) => Promise<void>]
  return listener({ payload: { connectionRecord } })
}

const connection = (overrides: Record<string, unknown>) => ({
  id: 'conn-1',
  state: DidCommDidExchangeState.Completed,
  theirDid: 'did:peer:2',
  previousTheirDids: [],
  getTag: () => undefined,
  ...overrides,
})

describe('connection events on a DID rotation', () => {
  beforeEach(async () => {
    on.mockReset()
    emit.mockReset()
    connectionService.updateState.mockReset()
    await connectionEvents(agent as never, { logger: logger as never })
  })

  it('marks a connection that the peer hung up as abandoned, so that the state change is delivered', async () => {
    const record = connection({ theirDid: undefined, previousTheirDids: ['did:peer:2'] })

    await didRotated(record)

    expect(connectionService.updateState).toHaveBeenCalledWith(
      agent.context,
      record,
      DidCommDidExchangeState.Abandoned,
    )
    expect(emit).toHaveBeenCalledWith(
      agent.context,
      expect.objectContaining({
        type: VsAgentEventTypes.ConnectionStateUpdated,
        payload: { event: expect.objectContaining({ connectionId: 'conn-1', state: 'terminated' }) },
      }),
    )
  })

  it('leaves a rotation to a new DID alone', async () => {
    await didRotated(connection({ theirDid: 'did:peer:3', previousTheirDids: ['did:peer:2'] }))

    expect(connectionService.updateState).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not mark a connection abandoned twice', async () => {
    await didRotated(
      connection({
        state: DidCommDidExchangeState.Abandoned,
        theirDid: undefined,
        previousTheirDids: ['did:peer:2'],
      }),
    )

    expect(connectionService.updateState).not.toHaveBeenCalled()
  })

  it('logs and survives a failed state update', async () => {
    connectionService.updateState.mockRejectedValueOnce(new Error('storage is closed'))

    await didRotated(connection({ theirDid: undefined, previousTheirDids: ['did:peer:2'] }))

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('storage is closed'))
  })
})
