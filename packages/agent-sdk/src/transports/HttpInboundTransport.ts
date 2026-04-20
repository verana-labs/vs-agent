import type { AgentContext } from '@credo-ts/core'
import type { Express, Request, Response } from 'express'
import type { Server } from 'http'

import { CredoError, utils } from '@credo-ts/core'
import {
  DidCommEncryptedMessage,
  DidCommInboundTransport,
  DidCommMessageReceiver,
  DidCommMimeType,
  DidCommModuleConfig,
  DidCommTransportService,
  DidCommTransportSession,
} from '@credo-ts/didcomm'
import express, { text } from 'express'

const supportedContentTypes: string[] = [DidCommMimeType.V0, DidCommMimeType.V1]

export class HttpInboundTransport implements DidCommInboundTransport {
  public app?: Express
  private port: number
  private path: string
  private _server?: Server

  public get server() {
    return this._server
  }

  public constructor({ path, port }: { path?: string; port: number }) {
    this.port = port
    this.path = path ?? '/'
  }

  public setApp(app: Express) {
    this.app = app
    this.setupMiddleware()
  }

  private setupMiddleware() {
    this.app?.use(text({ type: supportedContentTypes, limit: '5mb' }))
  }

  public async start(agentContext: AgentContext, app?: Express) {
    if (!this.app) {
      this.app = app ?? express()
      this.setupMiddleware()
    }
    const transportService = agentContext.dependencyManager.resolve(DidCommTransportService)
    const messageReceiver = agentContext.dependencyManager.resolve(DidCommMessageReceiver)

    agentContext.config.logger.debug(`Starting HTTP inbound transport`, {
      port: this.port,
    })

    this.app.post(this.path, async (req, res) => {
      const contentType = req.headers['content-type']

      if (!contentType || !supportedContentTypes.includes(contentType)) {
        return res
          .status(415)
          .send('Unsupported content-type. Supported content-types are: ' + supportedContentTypes.join(', '))
      }

      const session = new HttpTransportSession(utils.uuid(), req, res)
      try {
        const message = req.body
        const encryptedMessage = JSON.parse(message)
        await messageReceiver.receiveMessage(encryptedMessage, {
          session,
        })

        // If agent did not use session when processing message we need to send response here.
        if (!res.headersSent) {
          res.status(200).end()
        }
      } catch (error) {
        agentContext.config.logger.error(`Error processing inbound message: ${error.message}`, error)

        if (!res.headersSent) {
          res.status(500).send('Error processing message')
        }
      } finally {
        transportService.removeSession(session)
      }
    })

    this._server = this.app.listen(this.port)
  }

  public async stop(): Promise<void> {
    this._server?.close()
  }
}

export class HttpTransportSession implements DidCommTransportSession {
  public id: string
  public readonly type = 'http'
  public req: Request
  public res: Response

  public constructor(id: string, req: Request, res: Response) {
    this.id = id
    this.req = req
    this.res = res
  }

  public async close(): Promise<void> {
    if (!this.res.headersSent) {
      this.res.status(200).end()
    }
  }

  public async send(agentContext: AgentContext, encryptedMessage: DidCommEncryptedMessage): Promise<void> {
    if (this.res.headersSent) {
      throw new CredoError(`${this.type} transport session has been closed.`)
    }

    // By default we take the agent config's default DIDComm content-type
    let responseMimeType = agentContext.dependencyManager.resolve(DidCommModuleConfig).didCommMimeType

    // However, if the request mime-type is a mime-type that is supported by us, we use that
    // to minimize the chance of interoperability issues
    const requestMimeType = this.req.headers['content-type']
    if (requestMimeType && supportedContentTypes.includes(requestMimeType)) {
      responseMimeType = requestMimeType
    }

    this.res.status(200).contentType(responseMimeType).json(encryptedMessage).end()
  }
}
