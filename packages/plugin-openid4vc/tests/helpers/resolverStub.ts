import type { Server } from 'node:http'

import express from 'express'

export interface ResolverStubBehavior {
  trusted: Set<string>
  authorized: Set<string>
  down?: boolean
}

export interface ResolverStub {
  url: string
  behavior: ResolverStubBehavior
  requests: string[]
  readonly requestCount: number
  reset: () => void
  stop: () => Promise<void>
}

export async function startResolverStub(behavior: ResolverStubBehavior): Promise<ResolverStub> {
  const requests: string[] = []
  const app = express()
  let stopped = false

  app.use((request, _response, next) => {
    requests.push(request.originalUrl)
    next()
  })

  app.get('/v1/trust/resolve', (request, response) => {
    if (behavior.down) {
      response.status(503).json({ error: 'resolver unavailable' })
      return
    }

    const did = String(request.query.did)
    if (!behavior.trusted.has(did)) {
      response.status(404).json({ error: 'not found' })
      return
    }

    response.json({ did, trustStatus: 'TRUSTED' })
  })

  const authorizationHandler = (request: express.Request, response: express.Response): void => {
    if (behavior.down) {
      response.status(503).json({ error: 'resolver unavailable' })
      return
    }

    const did = String(request.query.did)
    response.json({ did, authorized: behavior.authorized.has(did) })
  }
  app.get('/v1/trust/issuer-authorization', authorizationHandler)
  app.get('/v1/trust/verifier-authorization', authorizationHandler)

  const server: Server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer))
    listeningServer.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('resolver stub did not bind a TCP port')
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1/trust`,
    behavior,
    requests,
    get requestCount() {
      return requests.length
    },
    reset: () => {
      requests.length = 0
    },
    stop: async () => {
      if (stopped) return
      stopped = true
      await closeServer(server)
    },
  }
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) reject(error)
      else resolve()
    })
  })
}
