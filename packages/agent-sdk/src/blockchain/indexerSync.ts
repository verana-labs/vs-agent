import { IndexerEventRecord } from './types'

export function eventKey(event: IndexerEventRecord): string {
  return `${event.tx_hash}:${event.payload.message_index}`
}

export function isProcessableEvent(event: IndexerEventRecord): boolean {
  return event.type === 'indexer-event' && event.block_height > 0 && Boolean(event.payload?.sender)
}

export function sortEventsByPosition(events: IndexerEventRecord[]): IndexerEventRecord[] {
  return [...events].sort((a, b) => {
    if (a.block_height !== b.block_height) return a.block_height - b.block_height
    if (a.payload.tx_index !== b.payload.tx_index) return a.payload.tx_index - b.payload.tx_index
    return a.payload.message_index - b.payload.message_index
  })
}

export interface RestCursorResult {
  done: boolean
  cursor: number
  blockExceedsPage: boolean
}

// A full page can stop partway through a block, so step back one block and let dedup skip the
// repeats. If one block fills the whole page, move past it.
export function nextRestCursor(
  events: IndexerEventRecord[],
  currentCursor: number,
  pageLimit: number,
): RestCursorResult {
  if (events.length < pageLimit) return { done: true, cursor: currentCursor, blockExceedsPage: false }
  const maxBlock = events.reduce((max, e) => (e.block_height > max ? e.block_height : max), currentCursor)
  const rewound = maxBlock - 1
  if (rewound > currentCursor) return { done: false, cursor: rewound, blockExceedsPage: false }
  return { done: false, cursor: maxBlock, blockExceedsPage: true }
}
