import { describe, expect, it, vi } from 'vitest'

import { EventDispatcher, EventEnvelope, UnknownEventEnvelope } from '../src'

const basicMessage: EventEnvelope<'didcomm.basic-messages.message-received'> = {
  id: 'evt-1',
  type: 'didcomm.basic-messages.message-received',
  timestamp: '2026-09-15T10:00:00.000Z',
  data: {
    id: 'bm-1',
    connectionId: 'c1',
    role: 'receiver',
    content: 'hello',
    sentTime: '2026-09-15T10:00:00.000Z',
    createdAt: '2026-09-15T10:00:00.000Z',
  },
}

describe('EventDispatcher', () => {
  it('routes by type and passes data and envelope in registration order', async () => {
    const calls: string[] = []
    const events = new EventDispatcher()
      .on('didcomm.basic-messages.message-received', (data, envelope) => {
        calls.push(`first:${data.content}:${envelope.id}`)
      })
      .on('didcomm.basic-messages.message-received', async data => {
        calls.push(`second:${data.connectionId}`)
      })
      .on('didcomm.connections.state-updated', () => {
        calls.push('never')
      })

    await events.dispatch(basicMessage)

    expect(calls).toEqual(['first:hello:evt-1', 'second:c1'])
  })

  it('ignores an unknown type', async () => {
    const handler = vi.fn()
    const events = new EventDispatcher().on('didcomm.basic-messages.message-received', handler)
    const unknown: UnknownEventEnvelope = {
      id: 'evt-2',
      type: 'didcomm.question-answer.question-received',
      timestamp: '2026-09-15T10:00:00.000Z',
      data: { connectionId: 'c1', threadId: 't1', message: {} },
    }

    await expect(events.dispatch(unknown)).resolves.toBeUndefined()
    expect(handler).not.toHaveBeenCalled()
  })

  it('propagates a handler rejection', async () => {
    const failure = new Error('boom')
    const events = new EventDispatcher().on('didcomm.basic-messages.message-received', () => {
      throw failure
    })

    await expect(events.dispatch(basicMessage)).rejects.toBe(failure)
  })
})
