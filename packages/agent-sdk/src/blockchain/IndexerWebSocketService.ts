import { BaseLogger } from '@credo-ts/core'
import { IndexerNotification } from '@verana-labs/vs-agent-model'
import WebSocket from 'ws'

import { VsAgent } from '../agent/VsAgent'
import { emitVsAgentEvent, VsAgentEventTypes } from '../events'

import { loadSyncState, saveSyncState } from './VeranaHelpers'
import { VeranaIndexerService } from './VeranaIndexerService'
import { applyStateMutation, buildDefaultIndexerHandlerRegistry } from './handlers'
import { IndexerHandlerRegistry } from './handlers/IndexerHandlerRegistry'
import { eventKey, isProcessableEvent, nextRestCursor, sortEventsByPosition } from './indexerSync'
import {
  IndexerActivity,
  IndexerBlockMessage,
  IndexerEventRecord,
  IndexerReadyMessage,
  IndexerSubscribeMessage,
  VeranaSyncState,
} from './types'

export interface IndexerWebSocketServiceOptions {
  indexerUrl: string
  agent: VsAgent
  handlerRegistry?: IndexerHandlerRegistry
  corporationId?: number
}

const MAX_RECONNECT_DELAY_MS = 300_000
const WS_PATHNAME = 'v4/indexer/subscribe'
const REST_PAGE_LIMIT = 500
const MAX_SYNC_BUFFER = 10_000
// The indexer pings every 30 seconds, so a longer gap means the socket is dead.
const LIVENESS_TIMEOUT_MS = 90_000

export class IndexerWebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private syncing = false
  private generation = 0
  private chain: Promise<void> = Promise.resolve()
  private syncBuffer: IndexerEventRecord[] = []
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
    this.clearWatchdog()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  private get logger() {
    return this.options.agent.config.logger
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const generation = ++this.generation
    this.syncing = true
    this.syncBuffer = []

    this.openWebSocket()

    try {
      await this.syncRest(generation)
    } catch (error) {
      this.logger.error(`[IndexerWS] Catch-up failed, will reconnect: ${(error as Error).message}`)
      if (generation === this.generation) this.forceReconnect('catch-up failed')
      return
    }

    if (this.stopped || generation !== this.generation) return
    this.syncing = false
    this.drainSyncBuffer(generation)
  }

  private openWebSocket(): void {
    const url = new URL(this.options.indexerUrl)
    const wsProto = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (!this.options.agent.did) throw new Error('Agent does not have any defined public DID')
    const wsUrl = `${wsProto}//${url.host}/${WS_PATHNAME}`

    this.logger.info(`[IndexerWS] Connecting to ${wsUrl}`)
    const ws = new WebSocket(wsUrl)
    this.ws = ws
    this.armWatchdog()

    ws.on('open', () => {
      if (ws === this.ws) this.logger.info(`[IndexerWS] Connected to indexer`)
    })

    ws.on('ping', () => {
      if (ws === this.ws) this.armWatchdog()
    })

    ws.on('message', (data: WebSocket.RawData) => {
      if (ws !== this.ws) return
      this.armWatchdog()
      this.handleMessage(ws, data)
    })

    ws.on('close', () => {
      if (ws !== this.ws) return
      this.clearWatchdog()
      if (!this.stopped) this.scheduleReconnect()
    })

    ws.on('error', (error: Error) => {
      this.logger.error(`[IndexerWS] Error: ${error.message}`)
    })
  }

  private handleMessage(ws: WebSocket, data: WebSocket.RawData): void {
    let message: IndexerReadyMessage | IndexerBlockMessage
    try {
      message = JSON.parse(data.toString())
    } catch {
      this.logger.warn(`[IndexerWS] Failed to parse message: ${data}`)
      return
    }

    if (message.type === 'ready') {
      this.reconnectAttempt = 0
      const subscribe: IndexerSubscribeMessage =
        this.options.corporationId != null
          ? { action: 'subscribe', corporationId: this.options.corporationId }
          : { action: 'subscribe', dids: this.options.agent.did ? [this.options.agent.did] : undefined }
      ws.send(JSON.stringify(subscribe))
      return
    }
    if (message.type !== 'block') return

    const generation = this.generation
    for (const event of message.events) {
      if (!isProcessableEvent(event)) continue
      if (!this.syncing) {
        this.enqueueLive(event, generation)
      } else if (this.syncBuffer.length < MAX_SYNC_BUFFER) {
        this.syncBuffer.push(event)
      } else {
        this.forceReconnect('sync buffer overflow')
        return
      }
    }
  }

  private async syncRest(generation: number): Promise<void> {
    if (!this.options.agent.did) throw new Error('Agent does not have any defined public DID')
    const did = this.options.agent.did
    const { lastBlockHeight } = await loadSyncState(this.options.agent)
    let cursor = lastBlockHeight

    for (;;) {
      if (this.stopped || generation !== this.generation) return
      const page = await this.indexer.getEvents(did, cursor, REST_PAGE_LIMIT, this.options.corporationId)
      for (const event of sortEventsByPosition(page.events.filter(isProcessableEvent))) {
        if (this.stopped || generation !== this.generation) return
        await this.runExclusive(() => this.applyEvent(event, generation))
      }

      const next = nextRestCursor(page.events, cursor, REST_PAGE_LIMIT)
      if (next.done) return
      if (next.blockExceedsPage) {
        this.logger.warn(
          `[IndexerWS] Block ${next.cursor} fills a full page; the events API cannot page within a block`,
        )
      }
      cursor = next.cursor
    }
  }

  private drainSyncBuffer(generation: number): void {
    const events = this.syncBuffer.splice(0)
    for (const event of sortEventsByPosition(events)) {
      this.enqueueLive(event, generation)
    }
  }

  private enqueueLive(event: IndexerEventRecord, generation: number): void {
    this.runExclusive(() => this.applyEvent(event, generation)).catch(error => {
      this.logger.error(
        `[IndexerWS] Live event ${event.event_type} failed at block ${event.block_height}: ${(error as Error).message}`,
      )
      if (generation === this.generation) this.forceReconnect('live event processing failed')
    })
  }

  private runExclusive(task: () => Promise<void>): Promise<void> {
    const result = this.chain.then(task)
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async applyEvent(event: IndexerEventRecord, generation: number): Promise<void> {
    if (this.stopped || generation !== this.generation) return
    const key = eventKey(event)
    const block = event.block_height

    const state = await loadSyncState(this.options.agent)
    if (block <= state.lastBlockHeight) return
    const partialKeys = state.partialKeys ?? []
    if (block === state.partialBlock && partialKeys.includes(key)) return

    const activity = await this.fetchActivity(event)
    if (this.stopped || generation !== this.generation) return
    if (activity) await this.applyChanges(event, activity, state)

    if (state.partialBlock === undefined || block > state.partialBlock) {
      state.partialBlock = block
      state.partialKeys = [key]
    } else {
      state.partialKeys = [...partialKeys, key]
    }
    // A block counts as done only when a later block arrives, so the saved height stays one behind.
    state.lastBlockHeight = Math.max(state.lastBlockHeight, block - 1)
    await saveSyncState(this.options.agent, state)
  }

  private async applyChanges(
    event: IndexerEventRecord,
    activity: IndexerActivity,
    state?: VeranaSyncState,
  ): Promise<void> {
    const syncState = state ?? (await loadSyncState(this.options.agent))
    const block = event.block_height

    applyStateMutation(syncState, activity)

    await this.handlerRegistry.dispatch(activity, {
      agent: this.options.agent,
      blockHeight: block,
      operatorAddress: event.payload.sender,
      state: syncState,
      txHash: event.tx_hash,
    })

    if (!state) {
      syncState.lastBlockHeight = Math.max(syncState.lastBlockHeight, block)
      await saveSyncState(this.options.agent, syncState)
    }

    try {
      emitVsAgentEvent(
        this.options.agent,
        VsAgentEventTypes.IndexerNotification,
        new IndexerNotification({
          msg: activity.msg,
          entityType: String(activity.entity_type),
          entityId: String(activity.entity_id),
          changes: activity.changes,
          blockHeight: block,
          txHash: event.tx_hash,
          operatorAddress: event.payload.sender,
          timestamp: new Date(event.timestamp),
        }),
      )
    } catch (err) {
      this.logger.error(`[IndexerWS] Failed to emit indexer notification: ${(err as Error).message}`)
    }
  }

  private async fetchActivity(event: IndexerEventRecord): Promise<IndexerActivity | undefined> {
    const entity_id = event.payload.entity_id
    if (!entity_id) return undefined

    const changes = await this.fetchEntity(event.payload.entity_type, entity_id)

    return {
      timestamp: event.timestamp,
      block_height: event.block_height,
      entity_type: event.payload.entity_type ?? '',
      entity_id,
      msg: event.event_type,
      changes,
      account: event.payload.sender,
    }
  }

  private async fetchEntity(entityType: string | undefined, id: string): Promise<Record<string, unknown>> {
    switch (entityType) {
      case 'Ecosystem':
        return (await this.indexer.getEcosystem(id)) as unknown as Record<string, unknown>
      case 'CredentialSchema':
        return (await this.indexer.getCredentialSchema(id)) as unknown as Record<string, unknown>
      case 'Participant':
        return (await this.indexer.getParticipant(id)) as unknown as Record<string, unknown>
      default:
        return {}
    }
  }

  private armWatchdog(): void {
    this.clearWatchdog()
    if (this.stopped) return
    this.watchdog = setTimeout(() => this.forceReconnect('liveness timeout'), LIVENESS_TIMEOUT_MS)
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
  }

  private forceReconnect(reason: string): void {
    if (this.stopped) return
    this.logger.warn(`[IndexerWS] Forcing reconnect: ${reason}`)
    this.generation++ // stops queued work so it cannot move the height past the failed event
    this.clearWatchdog()
    const ws = this.ws
    this.ws = null
    try {
      ws?.terminate()
    } finally {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempt++
    this.logger.info(`[IndexerWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.connect()
    }, delay)
  }
}
