import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ParentConnectionRepository } from '../src/connections/ParentConnectionModule'

const storageService = { save: vi.fn() }
const eventEmitter = { emit: vi.fn() }
const outOfBandRepository = { findById: vi.fn() }
const agentContext = {}

const repository = new ParentConnectionRepository(
  storageService as never,
  eventEmitter as never,
  outOfBandRepository as never,
)

const outOfBandRecord = (tags: Record<string, unknown>) => ({
  id: 'oob-1',
  getTag: (name: string) => tags[name],
})

const newConnection = (outOfBandId?: string) =>
  new DidCommConnectionRecord({
    role: DidCommDidExchangeRole.Responder,
    state: DidCommDidExchangeState.RequestReceived,
    outOfBandId,
  })

describe('ParentConnectionRepository', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gives a new connection the invitationId and parentConnectionId of the out-of-band record that an invitation record wraps', async () => {
    outOfBandRepository.findById.mockResolvedValue(
      outOfBandRecord({ invitationRecord: true, parentConnectionId: 'parent' }),
    )
    const connection = newConnection('oob-1')

    await repository.save(agentContext as never, connection)

    expect(connection.getTag('invitationId')).toBe('oob-1')
    expect(connection.getTag('parentConnectionId')).toBe('parent')
    expect(storageService.save).toHaveBeenCalledWith(agentContext, connection)
  })

  it('gives no invitationId to a connection from an out-of-band record that no invitation record wraps', async () => {
    outOfBandRepository.findById.mockResolvedValue(outOfBandRecord({}))
    const connection = newConnection('oob-1')

    await repository.save(agentContext as never, connection)

    expect(connection.getTag('invitationId')).toBeUndefined()
    expect(connection.getTag('parentConnectionId')).toBeUndefined()
  })

  it('reads no out-of-band record for a connection that has none', async () => {
    const connection = newConnection()

    await repository.save(agentContext as never, connection)

    expect(outOfBandRepository.findById).not.toHaveBeenCalled()
    expect(connection.getTag('invitationId')).toBeUndefined()
  })
})
