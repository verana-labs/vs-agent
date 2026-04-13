import WebSocket from 'ws'

import { TsLogger } from '../utils'

export interface IndexerWebSocketServiceOptions {
  indexerUrl: string
  agentDid: string
  logger: TsLogger
}

const MAX_RECONNECT_DELAY_MS = 300_000 // 5 minutes

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

  private connect() {
    const { indexerUrl, agentDid, logger } = this.options

    logger.info(`[IndexerWS] Connecting to ${indexerUrl}`)

    const ws = new WebSocket(indexerUrl)
    this.ws = ws

    ws.on('open', () => {
      logger.info(`[IndexerWS] Connected to indexer`)
      this.reconnectAttempt = 0

      // TODO: recieve events but, at the moment, we are not doing anything with them.
      ws.send(JSON.stringify({ type: 'subscribe', did: agentDid }))
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
}
