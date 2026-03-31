import type WebSocket from 'ws'

import {
  AgentConfig,
  CredoError,
  EventEmitter,
  Logger,
  JsonEncoder,
  Buffer,
  AgentContext,
} from '@credo-ts/core'
import {
  DidCommEventTypes,
  DidCommMessageReceivedEvent,
  DidCommOutboundPackage,
  DidCommOutboundTransport,
  DidCommOutboundWebSocketClosedEvent,
  DidCommTransportEventTypes,
  isValidJweStructure,
} from '@credo-ts/didcomm'

export function getProtocolScheme(url: string) {
  const [protocolScheme] = url.split(':')
  return protocolScheme
}

interface ExtWebSocket extends WebSocket {
  lastActivity: Date
}

export class VsAgentWsOutboundTransport implements DidCommOutboundTransport {
  private transportTable: Map<string, WebSocket> = new Map<string, WebSocket>()
  private agentContext!: AgentContext
  private logger!: Logger
  private eventEmitter!: EventEmitter
  private WebSocketClass!: typeof WebSocket
  public supportedSchemes = ['ws', 'wss']

  public constructor() {
    this.startIdleSocketTimer(60000)
  }

  private startIdleSocketTimer(interval: number) {
    setInterval(() => {
      const currentDate = new Date()
      this.transportTable.forEach(item => {
        if (currentDate.valueOf() - (item as ExtWebSocket).lastActivity.valueOf() > interval) {
          item.removeEventListener('message', this.handleMessageEvent)
          item.close()
          this.logger.debug('Socket closed by inactivity')
        }
      })
    }, interval)
  }

  public async start(agentContext: AgentContext): Promise<void> {
    this.agentContext = agentContext
    const agentConfig = this.agentContext.dependencyManager.resolve(AgentConfig)
    this.logger = agentConfig.logger
    this.eventEmitter = this.agentContext.dependencyManager.resolve(EventEmitter)
    this.logger.debug('Starting WS outbound transport')
    this.WebSocketClass = agentConfig.agentDependencies.WebSocketClass
  }

  public async stop() {
    this.logger.debug('Stopping WS outbound transport')
    this.transportTable.forEach(socket => {
      socket.removeEventListener('message', this.handleMessageEvent)
      socket.close()
      this.logger.debug('Socket closed!')
    })
  }

  public async sendMessage(outboundPackage: DidCommOutboundPackage) {
    const { payload, endpoint, connectionId } = outboundPackage
    this.logger.debug(`Sending outbound message to endpoint '${endpoint}' over WebSocket transport.`, {
      payload,
    })

    if (!endpoint) {
      throw new CredoError("Missing connection or endpoint. I don't know how and where to send the message.")
    }

    const socket = await this.resolveSocket({ socketId: endpoint, endpoint, connectionId })
    socket.send(Buffer.from(JSON.stringify(payload)))
    ;(socket as ExtWebSocket).lastActivity = new Date()
  }

  private async resolveSocket({
    socketId,
    endpoint,
    connectionId,
  }: {
    socketId: string
    endpoint?: string
    connectionId?: string
  }) {
    // If we already have a socket connection use it
    let socket = this.transportTable.get(socketId)

    if (!socket) {
      if (!endpoint) {
        throw new CredoError("Missing endpoint. I don't know how and where to send the message.")
      }
      socket = await this.createSocketConnection({
        endpoint,
        socketId,
        connectionId,
      })
      this.transportTable.set(socketId, socket)
      this.listenOnWebSocketMessages(socket)
    }

    if (socket.readyState !== this.WebSocketClass.OPEN) {
      throw new CredoError('Socket is not open.')
    }

    return socket
  }

  // NOTE: Because this method is passed to the event handler this must be a lambda method
  // so 'this' is scoped to the 'WsOutboundTransport' class instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleMessageEvent = (event: { type: string; data: any; target: WebSocket }) => {
    this.logger.trace('WebSocket message event received.', { url: event.target.url, data: event.data })
    ;(event.target as ExtWebSocket).lastActivity = new Date()
    const payload = JsonEncoder.fromBuffer(event.data)
    if (!isValidJweStructure(payload)) {
      throw new Error(
        `Received a response from the other agent but the structure of the
         incoming message is not a DIDComm message: ${payload}`,
      )
    }
    this.logger.debug('Payload received from mediator')
    this.eventEmitter.emit<DidCommMessageReceivedEvent>(this.agentContext, {
      type: DidCommEventTypes.DidCommMessageReceived,
      payload: {
        message: payload,
      },
    })
  }

  private listenOnWebSocketMessages(socket: WebSocket) {
    socket.addEventListener('message', this.handleMessageEvent)
  }

  private createSocketConnection({
    socketId,
    endpoint,
    connectionId,
  }: {
    socketId: string
    endpoint: string
    connectionId?: string
  }): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`Connecting to WebSocket ${endpoint}`)
      const socket = new this.WebSocketClass(endpoint)

      socket.onopen = () => {
        this.logger.debug(`Successfully connected to WebSocket ${endpoint}`)
        resolve(socket)
      }

      socket.onerror = error => {
        this.logger.debug(`Error while connecting to WebSocket ${endpoint}`, {
          error,
        })
        reject(error)
      }

      socket.onclose = async () => {
        this.logger.debug(`WebSocket closing to ${endpoint}`)
        socket.removeEventListener('message', this.handleMessageEvent)
        this.transportTable.delete(socketId)

        this.eventEmitter.emit<DidCommOutboundWebSocketClosedEvent>(this.agentContext, {
          type: DidCommTransportEventTypes.DidCommOutboundWebSocketClosedEvent,
          payload: {
            socketId,
            connectionId: connectionId,
          },
        })
      }
    })
  }
}
