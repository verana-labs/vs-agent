import { describe, expect, it, vi } from 'vitest'

import { connectToPublicDid } from '../src/utils/agent'

const AGENT_DID = 'did:webvh:QmAgent:agent.example'
const PEER_DID = 'did:webvh:QmPeer:peer.example'

interface ConnectionFixture {
  id: string
  isReady?: boolean
  theirDid?: string
  invitationDid?: string
  previousTheirDids?: string[]
}

const rotatedToPeer: ConnectionFixture = {
  id: 'existing',
  isReady: true,
  theirDid: 'did:peer:4zQmRotated',
  invitationDid: PEER_DID,
  previousTheirDids: [PEER_DID],
}

function makeAgent(records: ConnectionFixture[]) {
  const repository = { update: vi.fn(async () => undefined) }
  return {
    did: AGENT_DID,
    publicApiBaseUrl: 'https://agent.example',
    dids: { getCreatedDids: vi.fn(async () => []) },
    config: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
    context: { resolve: vi.fn(() => repository) },
    repository,
    didcomm: {
      connections: {
        findAllByQuery: vi.fn(async () => records),
        returnWhenIsConnected: vi.fn(async (id: string) => ({ id })),
        deleteById: vi.fn(async () => undefined),
      },
      oob: {
        receiveImplicitInvitation: vi.fn(async () => ({
          connectionRecord: { id: 'fresh-record', setTag: vi.fn() },
        })),
      },
    },
  }
}

describe('connectToPublicDid', () => {
  it('reuses the connection that the agent already has to the peer, after the peer rotated its DID', async () => {
    const agent = makeAgent([rotatedToPeer])

    const id = await connectToPublicDid(agent as never, PEER_DID)

    expect(id).toBe('existing')
    expect(agent.didcomm.connections.findAllByQuery).toHaveBeenCalledWith({
      publicDid: PEER_DID,
    })
    expect(agent.didcomm.oob.receiveImplicitInvitation).not.toHaveBeenCalled()
  })

  it('deletes a tagged connection the peer hung up on and dials again', async () => {
    const agent = makeAgent([
      { id: 'dead', isReady: true, theirDid: undefined, previousTheirDids: [PEER_DID] },
    ])

    const id = await connectToPublicDid(agent as never, PEER_DID)

    expect(agent.didcomm.connections.deleteById).toHaveBeenCalledWith('dead')
    expect(agent.didcomm.connections.deleteById.mock.invocationCallOrder[0]).toBeLessThan(
      agent.didcomm.oob.receiveImplicitInvitation.mock.invocationCallOrder[0],
    )
    expect(id).toBe('fresh-record')
  })

  it('deletes a tagged connection that never became ready and dials again', async () => {
    const agent = makeAgent([
      { id: 'stuck', isReady: false, theirDid: PEER_DID, invitationDid: PEER_DID, previousTheirDids: [] },
    ])

    const id = await connectToPublicDid(agent as never, PEER_DID)

    expect(agent.didcomm.connections.deleteById).toHaveBeenCalledWith('stuck')
    expect(agent.didcomm.connections.deleteById.mock.invocationCallOrder[0]).toBeLessThan(
      agent.didcomm.oob.receiveImplicitInvitation.mock.invocationCallOrder[0],
    )
    expect(id).toBe('fresh-record')
  })

  it('creates a connection when the agent has none to the peer', async () => {
    const agent = makeAgent([])

    const id = await connectToPublicDid(agent as never, PEER_DID)

    expect(id).toBe('fresh-record')
    expect(agent.didcomm.oob.receiveImplicitInvitation).toHaveBeenCalledWith({
      did: PEER_DID,
      ourDid: AGENT_DID,
      label: 'agent.example',
      didCommVersion: 'v2',
    })
  })

  it('tags the new connection with the public DID of the peer', async () => {
    const agent = makeAgent([])

    await connectToPublicDid(agent as never, PEER_DID)

    const { connectionRecord } = await agent.didcomm.oob.receiveImplicitInvitation.mock.results[0].value
    expect(connectionRecord.setTag).toHaveBeenCalledWith('publicDid', PEER_DID)
    expect(agent.repository.update).toHaveBeenCalled()
  })

  it('deletes the new connection when it does not become ready', async () => {
    const agent = makeAgent([])
    agent.didcomm.connections.returnWhenIsConnected = vi.fn(async () => {
      throw new Error('timeout')
    })

    await expect(connectToPublicDid(agent as never, PEER_DID)).rejects.toThrow('timeout')
    expect(agent.didcomm.connections.deleteById).toHaveBeenCalledWith('fresh-record')
  })

  it('throws when the agent has no public DID', async () => {
    const agent = makeAgent([])
    agent.did = undefined as never

    await expect(connectToPublicDid(agent as never, PEER_DID)).rejects.toThrow('Agent has no public DID')
  })
})
