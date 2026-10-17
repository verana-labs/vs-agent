import {
  DidCommConnectionRecord,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
  DidCommOutOfBandState,
} from '@credo-ts/didcomm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ParentConnectionRepository } from '../src/connections/ParentConnectionModule'

const saved: DidCommConnectionRecord[] = []
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1))

const storageService = {
  save: vi.fn(async (_context: unknown, record: DidCommConnectionRecord) => {
    await tick()
    saved.push(record)
  }),
  findByQuery: vi.fn(async (_context: unknown, _recordClass: unknown, query: Record<string, unknown>) => {
    await tick()
    return saved.filter(record =>
      Object.entries(query).every(([name, value]) => record.getTag(name) === value),
    )
  }),
}
const eventEmitter = { emit: vi.fn() }
const outOfBandRepository = { findById: vi.fn() }
const logger = { warn: vi.fn() }
const agentContext = { config: { logger } }

const repository = new ParentConnectionRepository(
  storageService as never,
  eventEmitter as never,
  outOfBandRepository as never,
)

const outOfBandRecord = (
  tags: Record<string, unknown>,
  { reusable = false, state = DidCommOutOfBandState.AwaitResponse } = {},
) => ({
  id: 'oob-1',
  reusable,
  state,
  getTag: (name: string) => tags[name],
})

const newConnection = (outOfBandId: string, theirDid?: string) =>
  new DidCommConnectionRecord({
    role: DidCommDidExchangeRole.Responder,
    state: DidCommDidExchangeState.RequestReceived,
    outOfBandId,
    theirDid,
  })

describe('ParentConnectionRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saved.length = 0
  })

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

  it('gives the invitationId of a single-use invitation to one of two connections saved at the same time', async () => {
    outOfBandRepository.findById.mockResolvedValue(
      outOfBandRecord({ invitationRecord: true, parentConnectionId: 'parent' }),
    )
    const first = newConnection('oob-1', 'did:peer:first')
    const second = newConnection('oob-1', 'did:peer:second')

    await Promise.all([
      repository.save(agentContext as never, first),
      repository.save(agentContext as never, second),
    ])

    expect(first.getTag('invitationId')).toBe('oob-1')
    expect(second.getTag('invitationId')).toBeUndefined()
    expect(second.getTag('parentConnectionId')).toBeUndefined()
    expect(saved).toEqual([first, second])
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0][0]).toContain('oob-1')
    expect(logger.warn.mock.calls[0][0]).toContain('did:peer:second')
  })

  it('gives no invitationId to a connection of a single-use invitation that a reuse already consumed', async () => {
    outOfBandRepository.findById.mockResolvedValue(
      outOfBandRecord({ invitationRecord: true }, { state: DidCommOutOfBandState.Done }),
    )
    const connection = newConnection('oob-1', 'did:peer:late')

    await repository.save(agentContext as never, connection)

    expect(connection.getTag('invitationId')).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('gives the invitationId of a reusable invitation to every connection', async () => {
    outOfBandRepository.findById.mockResolvedValue(
      outOfBandRecord({ invitationRecord: true }, { reusable: true }),
    )
    const first = newConnection('oob-1', 'did:peer:first')
    const second = newConnection('oob-1', 'did:peer:second')

    await Promise.all([
      repository.save(agentContext as never, first),
      repository.save(agentContext as never, second),
    ])

    expect(first.getTag('invitationId')).toBe('oob-1')
    expect(second.getTag('invitationId')).toBe('oob-1')
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
