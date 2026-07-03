import { describe, expect, it } from 'vitest'

import { nextRestCursor, sortEventsByPosition } from '../src/blockchain/indexerSync'
import { IndexerEventRecord } from '../src/blockchain/types'

function mkEvent(overrides: {
  block_height: number
  tx_hash?: string
  tx_index?: number
  message_index?: number
  sender?: string
  type?: string
}): IndexerEventRecord {
  return {
    type: (overrides.type as 'indexer-event') ?? 'indexer-event',
    event_type: 'TestMsg',
    did: 'did:web:agent.test',
    block_height: overrides.block_height,
    tx_hash: overrides.tx_hash ?? 'tx',
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      module: 'participant',
      action: 'TestMsg',
      message_type: '/verana.pp.v1.Test',
      tx_index: overrides.tx_index ?? 0,
      message_index: overrides.message_index ?? 0,
      sender: overrides.sender ?? 'verana1sender',
      related_dids: [],
    },
  }
}

describe('sortEventsByPosition', () => {
  it('orders by block, then tx_index, then message_index without mutating the input', () => {
    const input = [
      mkEvent({ block_height: 2, tx_index: 0, message_index: 0, tx_hash: 'd' }),
      mkEvent({ block_height: 1, tx_index: 1, message_index: 1, tx_hash: 'c' }),
      mkEvent({ block_height: 1, tx_index: 1, message_index: 0, tx_hash: 'b' }),
      mkEvent({ block_height: 1, tx_index: 0, message_index: 0, tx_hash: 'a' }),
    ]
    const sorted = sortEventsByPosition(input)
    expect(sorted.map(e => e.tx_hash)).toEqual(['a', 'b', 'c', 'd'])
    expect(input[0].tx_hash).toBe('d')
  })
})

describe('nextRestCursor', () => {
  const limit = 3

  it('reports done when a page is shorter than the limit', () => {
    const events = [mkEvent({ block_height: 10 }), mkEvent({ block_height: 11 })]
    expect(nextRestCursor(events, 5, limit)).toEqual({ done: true, cursor: 5, blockExceedsPage: false })
  })

  it('rewinds to maxBlock-1 on a full page spanning multiple blocks', () => {
    const events = [
      mkEvent({ block_height: 10 }),
      mkEvent({ block_height: 11 }),
      mkEvent({ block_height: 12 }),
    ]
    expect(nextRestCursor(events, 5, limit)).toEqual({ done: false, cursor: 11, blockExceedsPage: false })
  })

  it('advances past a block that fills a whole page, flagging the split', () => {
    const events = [
      mkEvent({ block_height: 12, message_index: 0 }),
      mkEvent({ block_height: 12, message_index: 1 }),
      mkEvent({ block_height: 12, message_index: 2 }),
    ]
    expect(nextRestCursor(events, 11, limit)).toEqual({ done: false, cursor: 12, blockExceedsPage: true })
  })
})
