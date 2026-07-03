import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VsAgent } from '../src/agent/VsAgent'
import { IndexerWebSocketService } from '../src/blockchain/IndexerWebSocketService'
import { loadSyncState, saveSyncState } from '../src/blockchain/VeranaHelpers'
import { IndexerHandlerRegistry } from '../src/blockchain/handlers/IndexerHandlerRegistry'
import { IndexerActivity, IndexerEventRecord } from '../src/blockchain/types'
import { fetchJson } from '../src/utils/util'

const { FakeWebSocket } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  class FakeWebSocket {
    static instances: FakeWebSocket[] = []
    static reset(): void {
      FakeWebSocket.instances = []
    }
    private listeners: Record<string, Listener[]> = {}
    url: string
    sent: string[] = []
    terminated = false
    constructor(url: string) {
      this.url = url
      FakeWebSocket.instances.push(this)
    }
    on(event: string, cb: Listener): this {
      ;(this.listeners[event] ??= []).push(cb)
      return this
    }
    emit(event: string, ...args: unknown[]): void {
      ;(this.listeners[event] ?? []).forEach(cb => cb(...args))
    }
    send(data: string): void {
      this.sent.push(data)
    }
    close(): void {
      this.emit('close')
    }
    terminate(): void {
      this.terminated = true
      this.emit('close')
    }
  }
  return { FakeWebSocket }
})

vi.mock('ws', () => ({ default: FakeWebSocket }))

vi.mock('../src/utils/util', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/utils/util')>()
  return { ...actual, fetchJson: vi.fn() }
})

const fetchJsonMock = vi.mocked(fetchJson)

function makeAgent(): VsAgent {
  const store = new Map<string, { id: string; content: unknown }>()
  const logger = {
    test: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }
  return {
    did: 'did:web:agent.test',
    config: { logger },
    genericRecords: {
      findById: async (id: string) => store.get(id) ?? null,
      update: async (record: { id: string; content: unknown }) => {
        store.set(record.id, record)
      },
      save: async (record: { id: string; content: unknown }) => {
        store.set(record.id, { id: record.id, content: record.content })
      },
    },
  } as unknown as VsAgent
}

function mkEvent(o: {
  block_height: number
  tx_hash?: string
  message_index?: number
  tx_index?: number
  entity_id?: string
  entity_type?: string
}): IndexerEventRecord {
  return {
    type: 'indexer-event',
    event_type: 'TestMsg',
    did: 'did:web:agent.test',
    block_height: o.block_height,
    tx_hash: o.tx_hash ?? `tx${o.block_height}`,
    timestamp: '2026-01-01T00:00:00Z',
    payload: {
      module: 'participant',
      action: 'TestMsg',
      message_type: '/verana.pp.v1.Test',
      tx_index: o.tx_index ?? 0,
      message_index: o.message_index ?? 0,
      sender: 'verana1sender',
      related_dids: [],
      entity_type: o.entity_type ?? 'ParticipantSession',
      entity_id: o.entity_id ?? '1',
    },
  }
}

const readyFrame = (): Buffer =>
  Buffer.from(JSON.stringify({ type: 'ready', block: 1, blockTime: '', blockIntervalMs: 6000 }))

const blockFrame = (block: number, events: IndexerEventRecord[]): Buffer =>
  Buffer.from(JSON.stringify({ type: 'block', block, blockTime: '', events }))

describe('IndexerWebSocketService', () => {
  let agent: VsAgent
  let registry: IndexerHandlerRegistry
  let service: IndexerWebSocketService | undefined

  beforeEach(() => {
    FakeWebSocket.reset()
    agent = makeAgent()
    registry = new IndexerHandlerRegistry()
    fetchJsonMock.mockReset()
    fetchJsonMock.mockResolvedValue({ events: [], count: 0, after_block_height: 0 })
  })

  afterEach(() => {
    service?.stop()
    service = undefined
    vi.useRealTimers()
  })

  function startWith(handle: (a: IndexerActivity) => Promise<void>): Promise<void> {
    registry.register({ msg: 'TestMsg', handle: async a => handle(a) })
    service = new IndexerWebSocketService({
      indexerUrl: 'http://indexer.test',
      agent,
      handlerRegistry: registry,
    })
    return service.start()
  }

  const lastWs = (): InstanceType<typeof FakeWebSocket> => FakeWebSocket.instances.at(-1)!

  it('sends a DID-scoped subscribe when the indexer is ready', async () => {
    await startWith(async () => undefined)
    lastWs().emit('message', readyFrame())
    const subscribe = lastWs().sent.map(s => JSON.parse(s))
    expect(subscribe).toContainEqual({ action: 'subscribe', dids: ['did:web:agent.test'] })
  })

  it('sends a corp-scoped subscribe and catch-up when corporationId is set', async () => {
    registry.register({ msg: 'TestMsg', handle: async () => undefined })
    service = new IndexerWebSocketService({
      indexerUrl: 'http://indexer.test',
      agent,
      handlerRegistry: registry,
      corporationId: 42,
    })
    await service.start()

    const catchupUrl = fetchJsonMock.mock.calls.at(0)?.[0] as string
    expect(catchupUrl).toContain('corporation_id=42')
    expect(catchupUrl).not.toContain('did=')

    lastWs().emit('message', readyFrame())
    const subscribe = lastWs().sent.map(s => JSON.parse(s))
    expect(subscribe).toContainEqual({ action: 'subscribe', corporationId: 42 })
    expect(subscribe).not.toContainEqual({ action: 'subscribe', dids: ['did:web:agent.test'] })
  })

  it('processes a live event once and advances the watermark on success', async () => {
    const dispatched: string[] = []
    await startWith(async a => {
      dispatched.push(String(a.entity_id))
    })
    const ws = lastWs()
    ws.emit('message', readyFrame())

    const event = mkEvent({ block_height: 10, tx_hash: 'aa', entity_id: 'A' })
    ws.emit('message', blockFrame(11, [event]))
    ws.emit('message', blockFrame(12, [event]))

    await vi.waitFor(() => expect(dispatched.length).toBeGreaterThanOrEqual(1))
    await new Promise(r => setTimeout(r, 20))

    expect(dispatched).toEqual(['A'])
    expect((await loadSyncState(agent)).lastBlockHeight).toBe(9)
  })

  it('serializes event processing instead of running handlers concurrently', async () => {
    const order: string[] = []
    await startWith(async a => {
      order.push(`start:${a.entity_id}`)
      await new Promise(r => setTimeout(r, 15))
      order.push(`end:${a.entity_id}`)
    })
    const ws = lastWs()
    ws.emit('message', readyFrame())
    ws.emit('message', blockFrame(11, [mkEvent({ block_height: 10, tx_hash: 'a', entity_id: 'A' })]))
    ws.emit('message', blockFrame(12, [mkEvent({ block_height: 11, tx_hash: 'b', entity_id: 'B' })]))

    await vi.waitFor(() => expect(order.length).toBe(4), { timeout: 2000 })
    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B'])
  })

  it('paginates the REST catch-up across pages', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) =>
      mkEvent({ block_height: i + 1, tx_hash: `p1-${i}`, entity_id: `e${i}` }),
    )
    const page2 = [mkEvent({ block_height: 600, tx_hash: 'p2-0', entity_id: 'last' })]
    fetchJsonMock.mockImplementation(async (url: string) => {
      const after = Number(new URL(url).searchParams.get('after_block_height'))
      if (after === 0) return { events: page1, count: 500, after_block_height: 0 }
      if (after === 499) return { events: page2, count: 1, after_block_height: 499 }
      return { events: [], count: 0, after_block_height: after }
    })

    const dispatched: string[] = []
    await startWith(async a => {
      dispatched.push(String(a.entity_id))
    })

    expect(dispatched.length).toBe(501)
    expect(dispatched.at(-1)).toBe('last')
    expect((await loadSyncState(agent)).lastBlockHeight).toBe(599)
  })

  it('keeps the watermark below a block until every event in it succeeds', async () => {
    const dispatched: string[] = []
    await startWith(async a => {
      if (a.entity_id === 'B') throw new Error('boom')
      dispatched.push(String(a.entity_id))
    })
    const ws = lastWs()
    ws.emit('message', readyFrame())
    const a = mkEvent({ block_height: 50, tx_hash: 'blk50', message_index: 0, entity_id: 'A' })
    const b = mkEvent({ block_height: 50, tx_hash: 'blk50', message_index: 1, entity_id: 'B' })
    ws.emit('message', blockFrame(50, [a, b]))

    await vi.waitFor(() => expect(ws.terminated).toBe(true))
    expect(dispatched).toEqual(['A'])
    // 49, not 50: block 50 is incomplete, so resync from > 49 re-includes the failed sibling B.
    expect((await loadSyncState(agent)).lastBlockHeight).toBe(49)
  })

  it('reconnects with a fresh socket after a liveness timeout', async () => {
    vi.useFakeTimers()
    await startWith(async () => undefined)
    const before = FakeWebSocket.instances.length

    vi.advanceTimersByTime(90_000)
    await vi.advanceTimersByTimeAsync(2000)

    expect(FakeWebSocket.instances.length).toBeGreaterThan(before)
  })

  it('reconnects instead of going live when REST catch-up fails', async () => {
    vi.useFakeTimers()
    let calls = 0
    fetchJsonMock.mockImplementation(async () => {
      if (++calls === 1) throw new Error('indexer 500')
      return { events: [], count: 0, after_block_height: 0 }
    })

    await startWith(async () => undefined)
    const before = FakeWebSocket.instances.length

    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before)
  })

  it('never advances the watermark past a failed block via a later queued live event', async () => {
    const dispatched: string[] = []
    await startWith(async a => {
      if (a.entity_id === 'B') throw new Error('boom')
      dispatched.push(String(a.entity_id))
    })
    const ws = lastWs()
    ws.emit('message', readyFrame())
    const a = mkEvent({ block_height: 50, tx_hash: 'b50', message_index: 0, entity_id: 'A' })
    const b = mkEvent({ block_height: 50, tx_hash: 'b50', message_index: 1, entity_id: 'B' })
    const c = mkEvent({ block_height: 51, tx_hash: 'b51', message_index: 0, entity_id: 'C' })
    ws.emit('message', blockFrame(50, [a, b]))
    ws.emit('message', blockFrame(51, [c]))

    await vi.waitFor(() => expect(ws.terminated).toBe(true))
    await new Promise(r => setTimeout(r, 20))

    // C (block 51) must not have been applied, and the watermark must not have reached block 50.
    expect(dispatched).toEqual(['A'])
    expect((await loadSyncState(agent)).lastBlockHeight).toBe(49)
  })

  it('skips an event whose block is already at or below the watermark (durable dedup floor)', async () => {
    await saveSyncState(agent, {
      lastBlockHeight: 100,
      ecosystems: {},
      credentialSchemas: {},
      participants: {},
    })
    const dispatched: string[] = []
    await startWith(async a => {
      dispatched.push(String(a.entity_id))
    })
    const ws = lastWs()
    ws.emit('message', readyFrame())
    ws.emit('message', blockFrame(50, [mkEvent({ block_height: 50, tx_hash: 'old', entity_id: 'OLD' })]))

    await new Promise(r => setTimeout(r, 30))
    expect(dispatched).toEqual([])
    expect((await loadSyncState(agent)).lastBlockHeight).toBe(100)
  })

  it('reconnects when an entity fetch fails so a hung request cannot wedge the queue', async () => {
    vi.useFakeTimers()
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes('/participant/get/')) throw new Error('participant fetch failed')
      return { events: [], count: 0, after_block_height: 0 }
    })

    await startWith(async () => undefined)
    const before = FakeWebSocket.instances.length
    const ws = lastWs()
    ws.emit('message', readyFrame())
    ws.emit(
      'message',
      blockFrame(10, [
        mkEvent({ block_height: 10, tx_hash: 'p', entity_id: '7', entity_type: 'Participant' }),
      ]),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(ws.terminated).toBe(true)

    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before)
  })

  it('does not re-apply already-applied events after a process restart (durable dedup)', async () => {
    const dispatched: string[] = []
    const handle = async (a: IndexerActivity): Promise<void> => {
      dispatched.push(String(a.entity_id))
    }
    const tail = mkEvent({ block_height: 50, tx_hash: 't50', entity_id: 'A' })

    registry.register({ msg: 'TestMsg', handle })
    const session1 = new IndexerWebSocketService({
      indexerUrl: 'http://indexer.test',
      agent,
      handlerRegistry: registry,
    })
    await session1.start()
    const ws1 = lastWs()
    ws1.emit('message', readyFrame())
    ws1.emit('message', blockFrame(50, [tail]))
    await vi.waitFor(() => expect(dispatched).toEqual(['A']))
    session1.stop()

    // Restart: fresh service + registry (so no in-memory dedup survives), same agent/persisted state.
    fetchJsonMock.mockImplementation(async (url: string) => {
      const after = Number(new URL(url).searchParams.get('after_block_height'))
      if (after === 49) return { events: [tail], count: 1, after_block_height: 49 }
      return { events: [], count: 0, after_block_height: after }
    })
    const registry2 = new IndexerHandlerRegistry()
    registry2.register({ msg: 'TestMsg', handle })
    const session2 = new IndexerWebSocketService({
      indexerUrl: 'http://indexer.test',
      agent,
      handlerRegistry: registry2,
    })
    await session2.start()
    session2.stop()

    expect(dispatched).toEqual(['A'])
  })
})
