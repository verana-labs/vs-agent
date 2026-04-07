import { Logger, AgentContext, CredoError, utils } from '@credo-ts/core'
import {
  DidCommApi,
  DidCommConnectionRecord,
  DidCommEncryptedMessage,
  DidCommInboundTransport,
  DidCommMessageReceiver,
  DidCommTransportService,
  DidCommTransportSession,
} from '@credo-ts/didcomm'
import WebSocket, { Server } from 'ws'

// Workaround for types (https://github.com/DefinitelyTyped/DefinitelyTyped/issues/20780)
interface ExtWebSocket extends WebSocket {
  isAlive: boolean
  lastActivity: Date
}

export class VsAgentWsInboundTransport implements DidCommInboundTransport {
  private socketServer: Server
  private logger!: Logger

  // We're using a `socketId` just for the prevention of calling the connection handler twice.
  private socketIds: Record<string, unknown> = {}

  public constructor({
    server,
    port,
  }: { server: Server; port?: undefined } | { server?: undefined; port: number }) {
    this.socketServer = server ?? new Server({ port })
  }

  public async start(agentContext: AgentContext) {
    const transportService = agentContext.dependencyManager.resolve(DidCommTransportService)
    const didcomm = agentContext.dependencyManager.resolve(DidCommApi)

    this.logger = agentContext.config.logger
    this.logger.debug('VS Agent Ws Inbound transport start')

    const wsEndpoint = didcomm.config.endpoints.find(e => e.startsWith('ws'))
    this.logger.debug(`Starting WS inbound transport`, {
      endpoint: wsEndpoint,
    })

    this.socketServer.on('connection', (socket: WebSocket) => {
      const socketId = utils.uuid()
      this.logger.debug('Socket connected.')
      ;(socket as ExtWebSocket).isAlive = true
      ;(socket as ExtWebSocket).lastActivity = new Date()
      if (!this.socketIds[socketId]) {
        this.logger.debug(`Saving new socket with id ${socketId}.`)
        this.socketIds[socketId] = socket
        const session = new WebSocketTransportSession(socketId, socket, this.logger)
        this.listenOnWebSocketMessages(agentContext, socket, session)
        socket.on('close', () => {
          this.logger.debug('Socket closed.')
          transportService.removeSession(session)
        })
      } else {
        this.logger.debug(`Socket with id ${socketId} already exists.`)
      }
    })

    this.startIdleSocketTimer(60000)
  }

  public async stop() {
    this.logger.debug('Closing WebSocket Server')

    return new Promise<void>((resolve, reject) => {
      this.socketServer.close(error => {
        if (error) {
          reject(error)
        }

        resolve()
      })
    })
  }

  public getServer() {
    this.logger.debug('Get WebSocket Server')

    return this.socketServer
  }

  private startIdleSocketTimer(interval: number) {
    setInterval(() => {
      const currentDate = new Date()
      this.socketServer.clients.forEach(item => {
        if (currentDate.valueOf() - (item as ExtWebSocket).lastActivity.valueOf() > interval) {
          this.logger.debug('Client session closed by inactivity')
          item.close()
        }
      })
    }, interval)
  }

  private listenOnWebSocketMessages(
    agentContext: AgentContext,
    socket: WebSocket,
    session: WebSocketTransportSession,
  ) {
    socket.on('pong', () => {
      this.logger.debug('Pong received')
      ;(socket as ExtWebSocket).isAlive = true
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.addEventListener('message', async (event: any) => {
      this.logger.debug('WebSocket message event received.', { url: event.target.url, data: event.data })
      ;(socket as ExtWebSocket).lastActivity = new Date()
      try {
        const messageReceiver = agentContext.dependencyManager.resolve(DidCommMessageReceiver)
        await messageReceiver.receiveMessage(JSON.parse(event.data), session)
      } catch (error) {
        this.logger.error('Error processing message')
      }
    })
  }
}

export class WebSocketTransportSession implements DidCommTransportSession {
  public id: string
  public readonly type = 'WebSocket'
  public socket: WebSocket
  public connection?: DidCommConnectionRecord
  public logger: Logger

  public constructor(id: string, socket: WebSocket, logger: Logger) {
    this.id = id
    this.socket = socket
    this.logger = logger
  }

  public async send(agentContext: AgentContext, encryptedMessage: DidCommEncryptedMessage): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new CredoError(`${this.type} transport session has been closed.`)
    }

    this.socket.send(JSON.stringify(encryptedMessage))
    ;(this.socket as ExtWebSocket).lastActivity = new Date()
  }

  public async close(): Promise<void> {
    this.logger.debug(`Web Socket Transport Session close requested. Connection Id: ${this.connection?.id}`)
    // Do not actually close socket. Leave heartbeat to do its job
  }
}
