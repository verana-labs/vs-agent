import { DidCommConnectionEventTypes, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { connectionEvents } from '../src/events/ConnectionEvents'

// VsAgent.initialize registers the listeners with the SCID-less DID of main.ts, and sets the
// persisted did:webvh only after it creates or loads the DID record.
const SCIDLESS_DID = 'did:webvh:agent.example'
const PUBLIC_DID = 'did:webvh:QmScid:agent.example'
const LEGACY_DID_WEB = 'did:web:agent.example'
const OOB_ID = 'oob-implicit'

type Handler = (event: { payload: { connectionRecord: unknown } }) => Promise<void>

function makeAgent() {
  const didRecord = {
    getTag: vi.fn((tag: string) => (tag === 'alternativeDids' ? [LEGACY_DID_WEB] : undefined)),
  }
  const agent = {
    did: SCIDLESS_DID,
    context: {},
    dids: {
      getCreatedDids: vi.fn(async ({ did }: { did: string }) =>
        did === PUBLIC_DID || did === LEGACY_DID_WEB ? [didRecord] : [],
      ),
    },
    events: { on: vi.fn(), emit: vi.fn() },
    didcomm: {
      oob: { findById: vi.fn() },
      connections: {
        acceptRequest: vi.fn(async () => undefined),
        findAllByOutOfBandId: vi.fn(async () => []),
        hangup: vi.fn(),
        deleteById: vi.fn(),
      },
    },
  }
  return agent
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

async function registerAndGetAcceptHandler(agent: ReturnType<typeof makeAgent>): Promise<Handler> {
  await connectionEvents(agent as never, { logger: logger as never })
  const handlers = agent.events.on.mock.calls
    .filter(([type]) => type === DidCommConnectionEventTypes.DidCommConnectionStateChanged)
    .map(([, handler]) => handler as Handler)
  // The auto-accept listener is the second state-changed listener the function registers.
  return handlers[1]
}

const requestReceived = (id = 'conn-1') => ({
  payload: {
    connectionRecord: { id, outOfBandId: OOB_ID, state: DidCommDidExchangeState.RequestReceived },
  },
})

describe('auto-accept of a connection request sent to the public DID', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a request that names the did:webvh the agent loaded after the listener was registered', async () => {
    const agent = makeAgent()
    const handler = await registerAndGetAcceptHandler(agent)
    agent.did = PUBLIC_DID
    agent.didcomm.oob.findById.mockResolvedValue({ outOfBandInvitation: { id: PUBLIC_DID } })

    await handler(requestReceived())

    expect(agent.didcomm.connections.acceptRequest).toHaveBeenCalledWith('conn-1')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('accepts a request that names the parallel did:web of the agent', async () => {
    const agent = makeAgent()
    const handler = await registerAndGetAcceptHandler(agent)
    agent.did = PUBLIC_DID
    agent.didcomm.oob.findById.mockResolvedValue({ outOfBandInvitation: { id: LEGACY_DID_WEB } })

    await handler(requestReceived())

    expect(agent.didcomm.connections.acceptRequest).toHaveBeenCalledWith('conn-1')
  })

  it('leaves a request unanswered and warns when it names a DID that is not the agent', async () => {
    const agent = makeAgent()
    const handler = await registerAndGetAcceptHandler(agent)
    agent.did = PUBLIC_DID
    agent.didcomm.oob.findById.mockResolvedValue({
      outOfBandInvitation: { id: 'did:webvh:QmOther:other.example' },
    })

    await handler(requestReceived())

    expect(agent.didcomm.connections.acceptRequest).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did:webvh:QmOther:other.example'))
  })

  it('ignores a request that comes from an explicit invitation', async () => {
    const agent = makeAgent()
    const handler = await registerAndGetAcceptHandler(agent)
    agent.did = PUBLIC_DID
    agent.didcomm.oob.findById.mockResolvedValue({ outOfBandInvitation: { id: 'invitation-uuid' } })

    await handler(requestReceived())

    expect(agent.didcomm.connections.acceptRequest).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('ignores every state other than request-received', async () => {
    const agent = makeAgent()
    const handler = await registerAndGetAcceptHandler(agent)
    agent.did = PUBLIC_DID

    await handler({
      payload: {
        connectionRecord: { id: 'conn-1', outOfBandId: OOB_ID, state: DidCommDidExchangeState.Completed },
      },
    })

    expect(agent.didcomm.oob.findById).not.toHaveBeenCalled()
    expect(agent.didcomm.connections.acceptRequest).not.toHaveBeenCalled()
  })
})
