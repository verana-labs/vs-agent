import { JsonObject } from '@credo-ts/core'
import WebSocket from 'ws'

import { VsAgent } from '../agent/VsAgent'
import { fetchJson } from '../utils/util'

import { applyActivity, loadSyncState, saveSyncState } from './VeranaHelpers'
import { VeranaIndexerService } from './VeranaIndexerService'
import { IndexerActivity, IndexerEventsResponse } from './types'

export interface IndexerWebSocketServiceOptions {
  indexerUrl: string
  agent: VsAgent
}

const MAX_RECONNECT_DELAY_MS = 300_000
const WS_PATHNAME = 'verana/indexer/v1/events'

interface PendingEvent {
  blockHeight: number
  sender: string
}

export class IndexerWebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private stopped = false
  private syncing = false
  private pendingEvents: PendingEvent[] = []
  private readonly indexer: VeranaIndexerService

  constructor(private readonly options: IndexerWebSocketServiceOptions) {
    this.indexer = new VeranaIndexerService({
      baseUrl: options.indexerUrl,
      logger: options.agent.config.logger as never,
    })
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

  private get agentDid(): string {
    return this.options.agent.did ?? ''
  }

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
    const wsUrl = `wss://${url.host}/${WS_PATHNAME}?did=${encodeURIComponent(this.agentDid)}`

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
          this.pendingEvents.push({ blockHeight, sender })
        } else {
          this.processBlock(blockHeight, sender).catch(err =>
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
        await this.processBlock(blockHeight, sender)
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

    for (const { blockHeight, sender } of events) {
      if (blockHeight <= lastBlockHeight) {
        skipped++
        continue
      }
      await this.processBlock(blockHeight, sender)
      processed++
    }

    if (skipped + processed > 0) {
      this.logger.info(`[IndexerWS] Drained: ${processed} processed, ${skipped} skipped`)
    }
  }

  private async processBlock(blockHeight: number, sender: string): Promise<void> {
    try {
      const changes = await this.indexer.getChanges(blockHeight)
      if (changes.activity.length > 0) {
        await this.applyChanges(blockHeight, changes.activity, sender)
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
  ): Promise<void> {
    const state = await loadSyncState(this.options.agent)
    const mine = activity.filter(
      a =>
        a.account === operatorAddress ||
        (typeof a.changes['did'] === 'string' && a.changes['did'] === this.agentDid),
    )

    if (mine.length === 0) return
    for (const a of mine) applyActivity(state, a)

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
    const url = this.buildHttpUrl(afterBlockHeight)
    this.logger.info(`[IndexerWS] Fetching initial events from ${url}`)
    const response = await fetchJson<IndexerEventsResponse>(url)
    this.logger.info(
      `[IndexerWS] Fetched: count=${response.count}, after_block_height=${response.after_block_height}`,
    )
    return response
  }

  private buildHttpUrl(afterBlockHeight = 0, limit = 100): string {
    const { indexerUrl } = this.options
    const url = new URL(indexerUrl)
    return `https://${url.host}/${WS_PATHNAME}?did=${encodeURIComponent(this.agentDid)}&after_block_height=${afterBlockHeight}&limit=${limit}`
  }
}
