import { BaseLogger, JsonObject } from '@credo-ts/core'
import WebSocket from 'ws'

import { VsAgent } from '../agent/VsAgent'

import { loadSyncState, saveSyncState } from './VeranaHelpers'
import { VeranaIndexerService } from './VeranaIndexerService'
import { buildDefaultIndexerHandlerRegistry } from './handlers'
import { IndexerHandlerRegistry } from './handlers/IndexerHandlerRegistry'
import { IndexerActivity, IndexerEventsResponse } from './types'

export interface IndexerWebSocketServiceOptions {
  indexerUrl: string
  agent: VsAgent
  handlerRegistry?: IndexerHandlerRegistry
}

const MAX_RECONNECT_DELAY_MS = 300_000
const WS_PATHNAME = 'verana/indexer/v1/events'

interface PendingEvent {
  blockHeight: number
  sender: string
  did: string
}

export class IndexerWebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private stopped = false
  private syncing = false
  private pendingEvents: PendingEvent[] = []
  private readonly indexer: VeranaIndexerService
  private readonly handlerRegistry: IndexerHandlerRegistry

  constructor(private readonly options: IndexerWebSocketServiceOptions) {
    this.indexer = new VeranaIndexerService({
      baseUrl: options.indexerUrl,
      logger: options.agent.config.logger as BaseLogger,
    })
    this.handlerRegistry = options.handlerRegistry ?? buildDefaultIndexerHandlerRegistry()
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  stop(): void {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  private get logger() {
    return this.options.agent.config.logger
  }

  /**
   * Connects to the indexer WebSocket, performs an initial sync via REST (use /events endpoint because it returns historical events in a single request)
   * Finally, processes pending events received during the initial sync.
   */
  private async connect(): Promise<void> {
    this.syncing = true
    this.pendingEvents = []
    this.openWebSocket()

    await this.syncRest()

    this.syncing = false
    await this.drainPendingEvents()
  }

  private openWebSocket(): void {
    const url = new URL(this.options.indexerUrl)
    const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (!this.options.agent.did) throw new Error('Agent does not have any defined public DID')
    const wsUrl = `${wsProto}//${url.host}/${WS_PATHNAME}?did=${encodeURIComponent(this.options.agent.did)}`

    this.logger.info(`[IndexerWS] Connecting to ${wsUrl}`)
    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.on('open', () => {
      this.logger.info(`[IndexerWS] Connected to indexer`)
      this.reconnectAttempt = 0
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as JsonObject
        const blockHeight = (event['block_height'] as number | undefined) ?? 0
        if (blockHeight <= 0) return

        const payload = event['payload'] as { sender?: string } | undefined
        if (!payload?.sender) return
        const sender = payload.sender

        if (this.syncing) {
          this.pendingEvents.push({ blockHeight, sender, did: event.did as string })
        } else {
          this.processBlock(blockHeight, sender, event.did as string).catch(err =>
            this.logger.error(`[IndexerWS] Handler error: ${(err as Error).message}`),
          )
        }
      } catch {
        this.logger.warn(`[IndexerWS] Failed to parse message: ${data}`)
      }
    })

    ws.on('close', () => {
      if (!this.stopped) this.scheduleReconnect()
    })

    ws.on('error', (error: Error) => {
      this.logger.error(`[IndexerWS] Error: ${error.message}`)
    })
  }

  private async syncRest(): Promise<void> {
    this.logger.info(`[IndexerWS] Starting REST initial sync`)
    try {
      const { lastBlockHeight } = await loadSyncState(this.options.agent)
      const data = await this.fetchInitialEvents(lastBlockHeight)

      for (const event of data.events) {
        const blockHeight = event.block_height as number
        const sender = (event.payload as { sender: string }).sender
        await this.processBlock(blockHeight, sender, event.did as string)
      }

      this.logger.info(`[IndexerWS] Initial sync complete: ${data.events.length} event(s)`)
    } catch (error) {
      this.logger.error(`[IndexerWS] REST initial sync failed: ${(error as Error).message}`)
    }
  }

  private async drainPendingEvents(): Promise<void> {
    const { lastBlockHeight } = await loadSyncState(this.options.agent)
    const events = this.pendingEvents.splice(0)
    let processed = 0
    let skipped = 0

    for (const { blockHeight, sender, did } of events) {
      if (blockHeight <= lastBlockHeight) {
        skipped++
        continue
      }
      await this.processBlock(blockHeight, sender, did)
      processed++
    }

    if (skipped + processed > 0) {
      this.logger.info(`[IndexerWS] Drained: ${processed} processed, ${skipped} skipped`)
    }
  }

  private async processBlock(blockHeight: number, sender: string, did: string): Promise<void> {
    try {
      const changes = await this.indexer.getChanges(blockHeight)
      if (changes.activity.length > 0) {
        await this.applyChanges(blockHeight, changes.activity, sender, did)
      }
    } catch (error) {
      this.logger.error(
        `[IndexerWS] Failed to fetch changes for block ${blockHeight}: ${(error as Error).message}`,
      )
    }
  }

  private async applyChanges(
    blockHeight: number,
    activity: IndexerActivity[],
    operatorAddress: string,
    did: string,
  ): Promise<void> {
    const state = await loadSyncState(this.options.agent)
    const mine = activity.filter(a => a.account === operatorAddress || did === this.options.agent.did)

    if (mine.length === 0) return

    for (const a of mine) {
      try {
        await this.handlerRegistry.dispatch(a, {
          agent: this.options.agent,
          blockHeight,
          operatorAddress,
          state,
        })
      } catch (err) {
        this.logger.error(
          `[IndexerWS] Handler ${a.msg} failed at block ${blockHeight}: ${(err as Error).message}`,
        )
      }
    }

    state.lastBlockHeight = Math.max(state.lastBlockHeight, blockHeight)
    await saveSyncState(this.options.agent, state)
    this.logger.debug(`[IndexerWS] Block ${blockHeight}: applied ${mine.length} activity item(s)`)
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempt++
    this.logger.info(`[IndexerWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
    setTimeout(() => {
      if (!this.stopped) this.connect()
    }, delay)
  }

  private async fetchInitialEvents(afterBlockHeight: number): Promise<IndexerEventsResponse> {
    this.logger.info(`[IndexerWS] Fetching initial events after block ${afterBlockHeight}`)
    if (!this.options.agent.did) throw new Error('Agent does not have any defined public DID')
    const response = await this.indexer.getEvents(this.options.agent.did, afterBlockHeight)
    this.logger.info(
      `[IndexerWS] Fetched: count=${response.count}, after_block_height=${response.after_block_height}`,
    )
    return response
  }
}
