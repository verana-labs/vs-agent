import { ApiClient, EventDispatcher, EventEnvelope } from '@verana-labs/vs-agent-client'
import cors from 'cors'
import express from 'express'
import type { Express, Request, Response } from 'express'
import { Logger } from 'tslog'

const logger = new Logger()

const PORT = Number(process.env.PORT || 5100)
const VS_AGENT_ADMIN_BASE_URL = process.env.VS_AGENT_ADMIN_BASE_URL || 'http://localhost:3000'
const CREDENTIAL_DEFINITION_ID = process.env.CREDENTIAL_DEFINITION_ID || undefined

const app: Express = express()
const client = new ApiClient(VS_AGENT_ADMIN_BASE_URL)
const refs = new Map<string, string>()

app.use(cors())
app.use(express.json())
app.set('json spaces', 2)

const events = new EventDispatcher().on('didcomm.presentations.state-updated', data => {
  const ref = refs.get(data.proofExchangeId)
  logger.info(
    `presentation ${data.proofExchangeId} ref=${ref ?? 'unknown'} state=${data.state} verified=${data.verified} claims=${JSON.stringify(data.claims)}`,
  )
  if (data.state === 'done' || data.state === 'abandoned' || data.state === 'declined') {
    refs.delete(data.proofExchangeId)
  }
})

app.get('/invitation/:ref', async (req: Request, res: Response): Promise<void> => {
  if (!CREDENTIAL_DEFINITION_ID) {
    res.status(503).json({ error: 'CREDENTIAL_DEFINITION_ID is not set' })
    return
  }
  const request = await client.didcomm.createPresentationRequest({
    requestedCredentials: [{ credentialDefinitionId: CREDENTIAL_DEFINITION_ID }],
    autoAccept: true,
  })
  refs.set(request.proofExchangeId, req.params.ref)
  logger.info(`presentation request ${request.proofExchangeId} created for ref ${req.params.ref}`)
  res.json(request)
})

app.post('/events', async (req: Request, res: Response): Promise<void> => {
  const envelope = req.body as EventEnvelope
  try {
    await events.dispatch(envelope)
    res.sendStatus(204)
  } catch (error) {
    logger.error(`Cannot handle event ${envelope.type}: ${error}`)
    res.sendStatus(500)
  }
})

const server = app.listen(PORT, (): void => {
  logger.info(`Demo verifier started on port ${PORT}`)
})

export { app, server }
