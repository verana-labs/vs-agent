import { Logger } from '@credo-ts/core'
import WebSocket from 'ws'

import { fetchJson } from '../utils/util'

import { IndexerEventsResponse } from './types'

export interface IndexerWebSocketServiceOptions {
  indexerUrl: string
  agentDid: string
  logger: Logger
}

const MAX_RECONNECT_DELAY_MS = 300_000 // 5 minutes
const pathname = 'verana/indexer/v1/events'

export class IndexerWebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private stopped = false

  constructor(private readonly options: IndexerWebSocketServiceOptions) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  private async connect() {
    const { indexerUrl, agentDid, logger } = this.options

    // Fetch initial events
    const initialData = await this.fetchInitialEvents()
    initialData.events.forEach(event => {
      logger.debug(`[IndexerWS] Initial event: ${JSON.stringify(event)}`)
    })

    const url = new URL(indexerUrl)

    const wsUrl = `wss://${url.host}/${pathname}?did=${encodeURIComponent(agentDid)}`

    logger.info(`[IndexerWS] Connecting to ${wsUrl}`)

    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.on('open', () => {
      logger.info(`[IndexerWS] Connected to indexer`)
      this.reconnectAttempt = 0

      // TODO: recieve events but, at the moment, we are not doing anything with them.
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString())
        logger.debug(`[IndexerWS] Event received: ${JSON.stringify(event)}`)
      } catch (error) {
        logger.warn(`[IndexerWS] Failed to parse message: ${data}`)
      }
    })

    ws.on('close', () => {
      if (!this.stopped) {
        this.scheduleReconnect()
      }
    })

    ws.on('error', (error: Error) => {
      logger.error(`[IndexerWS] Error: ${error.message}`)
      // close event will follow, which triggers reconnect
    })
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempt++
    this.options.logger.info(`[IndexerWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
    setTimeout(() => {
      if (!this.stopped) this.connect()
    }, delay)
  }

  private async fetchInitialEvents(): Promise<IndexerEventsResponse> {
    const { logger } = this.options

    try {
      const url = this.buildHttpUrl()
      logger.info(`[IndexerWS] Fetching initial events from ${url}`)

      const response = await fetchJson<IndexerEventsResponse>(url)
      logger.info(
        `[IndexerWS] Initial events fetched: count=${response.count}, after_block_height=${response.after_block_height}`,
      )
      return response
    } catch (error) {
      logger.error(`[IndexerWS] Failed to fetch initial events: ${(error as Error).message}`)
      throw error
    }
  }

  private buildHttpUrl(afterBlockHeight = 0, limit = 100) {
    const { indexerUrl, agentDid } = this.options
    const url = new URL(indexerUrl)

    return `https://${url.host}/${pathname}?did=${encodeURIComponent(agentDid)}&after_block_height=${afterBlockHeight}&limit=${limit}`
  }
}
