import { DidCommConnectionEventTypes, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { ECS } from '@verana-labs/vs-agent-model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { connectionEvents } from '../src/events/ConnectionEvents'
import { VsAgentEventTypes } from '../src/events/VsAgentEvents'
import { createInvitation } from '../src/utils/agent'
import { linkedVpFragment } from '../src/utils/setupSelfTr'

const DID = 'did:webvh:QmAgent:agent.example'
const OOB_ID = 'oob-1'

function makeAgent(serviceClaims?: Record<string, unknown>) {
  const entry = serviceClaims && {
    didDocumentServiceId: `${DID}#${linkedVpFragment(ECS.SERVICE)}`,
    credential: { credentialSubject: serviceClaims },
  }
  const didRecord = { metadata: { get: vi.fn(() => (entry ? { service: entry } : undefined)) } }
  return {
    did: DID,
    publicApiBaseUrl: 'https://agent.example',
    dids: { getCreatedDids: vi.fn(async () => [didRecord]) },
    didcomm: {
      config: { didcommVersions: ['v1', 'v2'] },
      oob: {
        createInvitation: vi.fn(async (_config: Record<string, unknown>) => ({
          outOfBandInvitation: {
            toJSON: () => ({ id: 'inv' }),
            toUrl: () => 'https://agent.example?_oob=inv',
            v2Invitation: undefined,
          },
        })),
      },
    },
  }
}

describe('createInvitation branding', () => {
  it('takes the label and the image from the ECS-Service credential', async () => {
    const agent = makeAgent({ name: 'Acme Service', logoUri: 'https://cdn/logo.png' })

    await createInvitation({ agent: agent as never })

    expect(agent.didcomm.oob.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Acme Service', imageUrl: 'https://cdn/logo.png' }),
    )
  })

  it('sends no label and no image when the agent holds no service credential', async () => {
    const agent = makeAgent()

    await createInvitation({ agent: agent as never })

    const [config] = agent.didcomm.oob.createInvitation.mock.calls[0]
    expect(config).toMatchObject({ label: undefined, imageUrl: undefined })
  })
})

describe('the single use of a v2 invitation', () => {
  const connection = (id: string, createdAt: string, didcommVersion: 'v1' | 'v2' = 'v2') => ({
    id,
    createdAt: new Date(createdAt),
    outOfBandId: OOB_ID,
    didcommVersion,
    state: DidCommDidExchangeState.Completed,
    getTag: vi.fn(() => undefined),
    setTag: vi.fn(),
  })

  const first = connection('first', '2026-01-01T10:00:00.000Z')
  const second = connection('second', '2026-01-01T10:00:05.000Z')

  const hangup = vi.fn()
  const deleteById = vi.fn()
  const findAllByOutOfBandId = vi.fn()
  const findById = vi.fn()
  const emit = vi.fn()

  const makeConnectedAgent = () => ({
    did: DID,
    context: {},
    dids: { getCreatedDids: vi.fn(async () => []) },
    events: { on: vi.fn(), emit },
    didcomm: {
      oob: { findById },
      connections: { findAllByOutOfBandId, hangup, deleteById },
    },
  })

  const stateChangeHandler = async () => {
    const agent = makeConnectedAgent()
    await connectionEvents(agent as never, { logger: { warn: vi.fn(), error: vi.fn() } as never })
    const [, handler] = agent.events.on.mock.calls.find(
      ([type]) => type === DidCommConnectionEventTypes.DidCommConnectionStateChanged,
    ) as [string, (event: { payload: { connectionRecord: unknown } }) => Promise<void>]
    return handler
  }

  const stateUpdates = () =>
    emit.mock.calls.filter(([, event]) => event.type === VsAgentEventTypes.ConnectionStateUpdated)

  beforeEach(() => {
    vi.clearAllMocks()
    findById.mockResolvedValue({ id: OOB_ID, reusable: false, getTag: vi.fn(() => undefined) })
    findAllByOutOfBandId.mockResolvedValue([first, second])
  })

  it('closes the connection that comes after the first one, and reports no state for it', async () => {
    const handler = await stateChangeHandler()

    await handler({ payload: { connectionRecord: second } })

    expect(hangup).toHaveBeenCalledWith({ connectionId: 'second' })
    expect(deleteById).toHaveBeenCalledWith('second')
    expect(stateUpdates()).toHaveLength(0)
  })

  it('keeps the first connection of the invitation', async () => {
    const handler = await stateChangeHandler()

    await handler({ payload: { connectionRecord: first } })

    expect(hangup).not.toHaveBeenCalled()
    expect(deleteById).not.toHaveBeenCalled()
    expect(stateUpdates()).toHaveLength(1)
  })

  it('deletes the connection although the hangup fails', async () => {
    hangup.mockRejectedValue(new Error('the peer is unreachable'))
    const handler = await stateChangeHandler()

    await handler({ payload: { connectionRecord: second } })

    expect(deleteById).toHaveBeenCalledWith('second')
  })

  it('keeps every connection of a multi-use invitation', async () => {
    findById.mockResolvedValue({ id: OOB_ID, reusable: true, getTag: vi.fn(() => undefined) })
    const handler = await stateChangeHandler()

    await handler({ payload: { connectionRecord: second } })

    expect(hangup).not.toHaveBeenCalled()
    expect(stateUpdates()).toHaveLength(1)
  })

  it('leaves a v1 connection to the handshake of the DID exchange protocol', async () => {
    const v1 = connection('second', '2026-01-01T10:00:05.000Z', 'v1')
    findAllByOutOfBandId.mockResolvedValue([first, v1])
    const handler = await stateChangeHandler()

    await handler({ payload: { connectionRecord: v1 } })

    expect(hangup).not.toHaveBeenCalled()
    expect(stateUpdates()).toHaveLength(1)
  })
})
