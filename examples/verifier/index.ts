import { ApiClient, ExpressEventHandler, ApiVersion } from '@verana-labs/vs-agent-client'
import type { Express } from 'express'
import cors from 'cors'
import express from 'express'
import path from 'path'
import { Logger } from 'tslog'

const logger = new Logger()

const PORT = Number(process.env.PORT || 5100)
const SERVICE_AGENT_BASE_URL = process.env.VS_AGENT_ADMIN_BASE_URL || 'http://localhost:3000/v1'
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:5100'
const app: Express = express()

const [baseUrl, versionPath] = SERVICE_AGENT_BASE_URL.split('/v')
const version = versionPath ? `v${versionPath}` : ApiVersion.V1
const apiClient = new ApiClient(baseUrl, version as ApiVersion)

const staticDir = path.join(__dirname, 'public')
app.use(express.static(staticDir))

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.set('json spaces', 2)
const expressHandler = new ExpressEventHandler(app)

const CREDENTIAL_DEFINITION_ID =
  process.env.CREDENTIAL_DEFINITION_ID ||
  'did:web:chatbot-demo.dev.2060.io?service=anoncreds&relativeRef=/credDef/HngJhYMeTLTZNa5nJxDybmXDsV8J7G1fz2JFSs3jcouT'

const server = app.listen(PORT, async () => {
  logger.info(`Demo verifier started on port ${PORT}`)
})

expressHandler.connectionState(async (req, res) => {
  const obj = req.body
  logger.info(`connection state updated: ${JSON.stringify(obj)}`)
  res.json({ message: 'ok' })
})

expressHandler.messageReceived(async (req, res) => {
  const obj = req.body.message
  logger.info(`received message: ${JSON.stringify(obj)}`)
  res.json({ message: 'ok' }).send()
})

app.get('/invitation/:ref', async (req, res) => {
  logger.info(`Generate invitation`)

  const presReq = await apiClient.invitations.createPresentationRequest({
    ref: req.params.ref,
    callbackUrl: `${PUBLIC_BASE_URL}/presentation`,
    requestedCredentials: [
      {
        credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
      },
    ],
  })

  res.json(presReq)
})

app.post('/presentation', async (req, res) => {
  logger.info(`Presentation received: ${JSON.stringify(req.body)}`)
  res.end()
})

export { app, server }
