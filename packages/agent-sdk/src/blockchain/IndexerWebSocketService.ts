import { BaseLogger } from '@credo-ts/core'
import WebSocket from 'ws'

import { VsAgent } from '../agent/VsAgent'

import { loadSyncState, saveSyncState } from './VeranaHelpers'
import { VeranaIndexerService } from './VeranaIndexerService'
import { buildDefaultIndexerHandlerRegistry } from './handlers'
import { IndexerHandlerRegistry } from './handlers/IndexerHandlerRegistry'
import { IndexerActivity, IndexerEventRecord, IndexerEventsResponse } from './types'

export interface IndexerWebSocketServiceOptions {
  indexerUrl: string
  agent: VsAgent
  handlerRegistry?: IndexerHandlerRegistry
}

const MAX_RECONNECT_DELAY_MS = 300_000
const WS_PATHNAME = 'verana/indexer/v1/events'
const CREATE_EVENT_ID_SOURCES: Record<string, { chainEventType: string; attrKey: string }> = {
  CreateNewTrustRegistry: { chainEventType: 'create_trust_registry', attrKey: 'trust_registry_id' },
  CreateNewCredentialSchema: { chainEventType: 'create_credential_schema', attrKey: 'credential_schema_id' },
  StartPermissionVP: { chainEventType: 'start_permission_vp', attrKey: 'permission_id' },
}

export class IndexerWebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private stopped = false
  private syncing = false
  private IndexerEventRecords: IndexerEventRecord[] = []
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
    this.IndexerEventRecords = []
    this.openWebSocket()

    await this.syncRest()

    this.syncing = false
    await this.drainIndexerEventRecords()
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
        const event = JSON.parse(data.toString()) as IndexerEventRecord
        if (event.type !== 'indexer-event') return
        if (event.block_height <= 0) return
        if (!event.payload?.sender) return

        if (this.syncing) {
          this.IndexerEventRecords.push(event)
        } else {
          this.processBlock(event).catch(err =>
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
        await this.processBlock(event)
      }

      this.logger.info(`[IndexerWS] Initial sync complete: ${data.events.length} event(s)`)
    } catch (error) {
      this.logger.error(`[IndexerWS] REST initial sync failed: ${(error as Error).message}`)
    }
  }

  private async drainIndexerEventRecords(): Promise<void> {
    const { lastBlockHeight } = await loadSyncState(this.options.agent)
    const events = this.IndexerEventRecords.splice(0)
    let processed = 0
    let skipped = 0

    for (const event of events) {
      if (event.block_height <= lastBlockHeight) {
        skipped++
        continue
      }
      await this.processBlock(event)
      processed++
    }

    if (skipped + processed > 0) {
      this.logger.info(`[IndexerWS] Drained: ${processed} processed, ${skipped} skipped`)
    }
  }

  private async processBlock(event: IndexerEventRecord): Promise<void> {
    try {
      const activity = CREATE_EVENT_ID_SOURCES[event.event_type]
        ? await this.resolveCreateActivity(event)
        : await this.fetchActivity(event)

      if (activity) {
        await this.applyChanges(event, activity)
      }
    } catch (error) {
      this.logger.error(
        `[IndexerWS] Failed to process event ${event.event_type} block=${event.block_height}: ${(error as Error).message}`,
      )
    }
  }

  /**
   * TODO: Once the indexer emits consistent event_id for create events, we can remove this workaround
   */
  private async resolveCreateActivity(event: IndexerEventRecord): Promise<IndexerActivity | undefined> {
    const source = CREATE_EVENT_ID_SOURCES[event.event_type]
    if (!source) return undefined

    const entity_id = await this.resolveIdFromTx(event, source.chainEventType, source.attrKey)
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

  private async fetchActivity(event: IndexerEventRecord): Promise<IndexerActivity | undefined> {
    const entity_id = event.payload.entity_id
    if (!entity_id) {
      this.logger.warn(`[IndexerWS] No entity_id for event ${event.event_type} — skipping`)
      return undefined
    }

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

  private async resolveIdFromTx(
    event: IndexerEventRecord,
    chainEventType: string,
    attrKey: string,
  ): Promise<string | undefined> {
    const chain = this.options.agent.veranaChain
    if (!chain || !event.tx_hash) return undefined
    try {
      const id = await chain.extractIdFromEvent(event.tx_hash, chainEventType, attrKey)
      return String(id)
    } catch (err) {
      this.logger.warn(
        `[IndexerWS] Could not resolve ${attrKey} from tx ${event.tx_hash}: ${(err as Error).message}`,
      )
      return undefined
    }
  }

  private async fetchEntity(entityType: string | undefined, id: string): Promise<Record<string, unknown>> {
    switch (entityType) {
      case 'TrustRegistry':
        return (await this.indexer.getTrustRegistry(id)) as unknown as Record<string, unknown>
      case 'CredentialSchema':
        return (await this.indexer.getCredentialSchema(id)) as unknown as Record<string, unknown>
      case 'Permission':
        return (await this.indexer.getPermission(id)) as unknown as Record<string, unknown>
      default:
        return {}
    }
  }

  private async applyChanges(event: IndexerEventRecord, activity: IndexerActivity): Promise<void> {
    const state = await loadSyncState(this.options.agent)
    const { block_height } = event

    try {
      await this.handlerRegistry.dispatch(activity, {
        agent: this.options.agent,
        block_height,
        operatorAddress: event.payload.sender,
        state,
        txHash: event.tx_hash,
      })
    } catch (err) {
      this.logger.error(
        `[IndexerWS] Handler ${event.event_type} failed at block ${event.block_height}: ${(err as Error).message}`,
      )
    }

    state.lastBlockHeight = Math.max(state.lastBlockHeight, event.block_height)
    await saveSyncState(this.options.agent, state)
    this.logger.debug(`[IndexerWS] Block ${event.block_height}: applied ${event.event_type}`)
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
