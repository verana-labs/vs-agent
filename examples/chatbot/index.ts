import {
  ApiClient,
  ApiError,
  EventDispatcher,
  EventEnvelope,
  SharedMediaItem,
} from '@verana-labs/vs-agent-client'
import cors from 'cors'
import { createDecipheriv, createHash, randomUUID } from 'crypto'
import express from 'express'
import type { Express, Request, Response } from 'express'
import { statSync } from 'fs'
import fetch from 'node-fetch'
import path from 'path'
import QRCode from 'qrcode'
import { Logger } from 'tslog'

import {
  helpMessage,
  mediaFixtures,
  rockyQuotes,
  rootContextMenu,
  rootMenuAsQA,
  testQuestion,
  welcomeMessage,
  worldCupPoll,
} from './data'
import packageJson from './package.json'

const logger = new Logger()

const PORT = Number(process.env.PORT || 5000)
const VS_AGENT_ADMIN_BASE_URL = process.env.VS_AGENT_ADMIN_BASE_URL || 'http://localhost:3000'
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:5000'
const VISION_SERVICE_BASE_URL =
  process.env.VISION_SERVICE_BASE_URL || 'https://webrtc-pymediasoup-client-demo.dev.2060.io'
const WEBRTC_SERVER_BASE_URL = process.env.WEBRTC_SERVER_BASE_URL || 'https://dts-webrtc.dev.2060.io'
const CREDENTIAL_DEFINITION_ID = process.env.CREDENTIAL_DEFINITION_ID || undefined
const MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000
const DEFAULT_PHONE_NUMBER = '+5712345678'
const TRACED_MESSAGE_MEMORY = 200
const MAXIMUM_QUESTION_OPTIONS = 10
const DEFAULT_QUESTION_OPTIONS = 3

const app: Express = express()
const client = new ApiClient(VS_AGENT_ADMIN_BASE_URL)
const events = new EventDispatcher()

const staticDir = path.join(__dirname, '..', 'public')
app.use(express.static(staticDir))

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.set('json spaces', 2)

let revocationRegistryDefinitionId: string | undefined
let revocationRegistryIndex = 0

interface IssuedCredential {
  connectionId: string
  revocationRegistryDefinitionId?: string
  revocationRegistryIndex?: number
}

const issuedCredentials = new Map<string, IssuedCredential>()
const proofRequests = new Map<string, string>()

interface ConnectionSettings {
  echoMedia: boolean
  trace: boolean
}

const defaultConnectionSettings: ConnectionSettings = { echoMedia: false, trace: false }

const connectionSettings = new Map<string, ConnectionSettings>()

const settingsOf = (connectionId: string): ConnectionSettings =>
  connectionSettings.get(connectionId) ?? defaultConnectionSettings

const tracedMessageIds = new Set<string>()
const testQuestionThreadIds = new Set<string>()

interface OngoingCall {
  wsUrl: string
  roomId: string
  connectionId: string
}

const ongoingCalls: OngoingCall[] = []

const server = app.listen(PORT, async (): Promise<void> => {
  logger.info(`Demo chatbot started on port ${PORT}`)

  if (!CREDENTIAL_DEFINITION_ID) {
    logger.warn('CREDENTIAL_DEFINITION_ID is not set, credential issuance and proof requests are disabled')
    return
  }
  logger.info(`credentialDefinitionId: ${CREDENTIAL_DEFINITION_ID}`)

  try {
    const registries = await client.anoncreds.listRevocationRegistries({
      credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
    })
    revocationRegistryDefinitionId =
      registries.items[0] ??
      (
        await client.anoncreds.createRevocationRegistry({
          credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
          maximumCredentialNumber: 1000,
        })
      ).revocationRegistryDefinitionId
    logger.info(`revocationRegistryDefinitionId: ${revocationRegistryDefinitionId}`)
  } catch (error) {
    logger.error(`Could not get or create the revocation registry: ${error}`)
  }
})

const sendRootMenu = async (connectionId: string): Promise<void> => {
  await client.didcomm.sendMenu({ connectionId, menu: rootContextMenu })
}

const sendText = async (connectionId: string, content: string): Promise<string | undefined> => {
  const { id } = await client.didcomm.sendBasicMessage({ connectionId, content })
  return id
}

const sendTrace = async (connectionId: string, line: string): Promise<void> => {
  if (!settingsOf(connectionId).trace) return

  const messageId = await sendText(connectionId, line)
  if (!messageId) return

  tracedMessageIds.add(messageId)
  if (tracedMessageIds.size > TRACED_MESSAGE_MEMORY) {
    const oldest = tracedMessageIds.values().next().value
    if (oldest) tracedMessageIds.delete(oldest)
  }
}

const sendQuestion = async (
  connectionId: string,
  question: { prompt: string; menuItems: { id: string; text: string }[] },
): Promise<string> => {
  const { id } = await client.didcomm.sendQuestion({
    connectionId,
    question: question.prompt,
    validResponses: question.menuItems.map(item => ({ text: item.text })),
  })
  return id
}

const issueCredential = async (connectionId: string, phoneNumber?: string): Promise<void> => {
  if (!CREDENTIAL_DEFINITION_ID) {
    await sendText(connectionId, 'Service not available')
    return
  }
  let index: number | undefined
  if (revocationRegistryDefinitionId) {
    revocationRegistryIndex += 1
    index = revocationRegistryIndex
  }
  // The offer goes out on the chat connection, so the wallet shows it in this
  // conversation and no link is needed.
  const offer = await client.didcomm.createCredentialOffer({
    credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
    claims: [{ name: 'phoneNumber', value: phoneNumber || DEFAULT_PHONE_NUMBER, mimeType: 'text/plain' }],
    connectionId,
    revocationRegistryDefinitionId,
    revocationRegistryIndex: index,
    autoAccept: true,
  })
  issuedCredentials.set(offer.credentialExchangeId, {
    connectionId,
    revocationRegistryDefinitionId,
    revocationRegistryIndex: index,
  })
}

const requestProof = async (connectionId: string): Promise<void> => {
  if (!CREDENTIAL_DEFINITION_ID) {
    await sendText(connectionId, 'Service not available')
    return
  }
  await sendText(connectionId, 'In order to start a new chat, we need some verifiable information from you')
  const request = await client.didcomm.createPresentationRequest({
    requestedCredentials: [{ credentialDefinitionId: CREDENTIAL_DEFINITION_ID, attributes: ['phoneNumber'] }],
    connectionId,
    autoAccept: true,
  })
  proofRequests.set(request.proofExchangeId, connectionId)
}

const revokeCredential = async (connectionId: string, credentialExchangeId: string): Promise<void> => {
  const issued = issuedCredentials.get(credentialExchangeId)
  if (!issued?.revocationRegistryDefinitionId || issued.revocationRegistryIndex === undefined) {
    await sendText(connectionId, `No revocable credential found for exchange id ${credentialExchangeId}`)
    return
  }
  await client.anoncreds.revokeCredential({
    revocationRegistryDefinitionId: issued.revocationRegistryDefinitionId,
    revocationRegistryIndex: issued.revocationRegistryIndex,
  })
  issuedCredentials.delete(credentialExchangeId)
  await sendText(connectionId, `Credential ${credentialExchangeId} revoked`)
}

const handleMenuSelection = async (connectionId: string, item: string): Promise<void> => {
  logger.info(`handleMenuSelection: ${item}`)

  if (item === 'poll' || item === 'Sure!' || item === '⚽ World Cup poll') {
    await sendQuestion(connectionId, worldCupPoll)
  }

  if (item === 'home' || item === '🏡 Home') {
    await sendText(connectionId, welcomeMessage)
  }

  if (item === 'issue' || item === 'Issue credential') {
    await issueCredential(connectionId)
  }

  if (item === 'proof' || item === 'Request proof') {
    await requestProof(connectionId)
  }

  if (item === 'help' || item === '🆘 Help') {
    await sendText(connectionId, helpMessage)
  }

  if (item === 'rocky' || item === '💪 Rocky quotes' || item === 'Inspire me!') {
    await sendText(connectionId, rockyQuotes[Math.floor(Math.random() * rockyQuotes.length)])
    await sendQuestion(connectionId, {
      prompt: 'Another inspiring Rocky quote?',
      menuItems: [
        { id: 'rocky', text: 'Inspire me!' },
        { id: 'idle', text: 'No' },
      ],
    })
    return
  }

  const worldCupResponses = worldCupPoll.menuItems.map(menuItem => menuItem.id)
  if (worldCupResponses.includes(item)) {
    if (item === 'argentina') {
      await sendText(connectionId, 'Correct! Vamos Argentina!')
    } else {
      await sendText(connectionId, 'No way...')
      await sendQuestion(connectionId, {
        prompt: 'Do you want to try again?',
        menuItems: [
          { id: 'poll', text: 'Sure!' },
          { id: 'idle', text: 'No' },
        ],
      })
    }
  }
}

const parameterRegExp = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g

const offerCall = async (connectionId: string, wsUrlArg?: string, roomIdArg?: string): Promise<void> => {
  let wsUrl = wsUrlArg
  let roomId = roomIdArg

  try {
    if (!wsUrl || !roomId) {
      const result = await fetch(`${WEBRTC_SERVER_BASE_URL}/rooms`, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ maxPeerCount: 2, eventNotificationUri: `${PUBLIC_BASE_URL}/call-events` }),
      })
      const response = (await result.json()) as { wsUrl: string; roomId: string }
      wsUrl = response.wsUrl
      roomId = response.roomId
    }

    ongoingCalls.push({ wsUrl, roomId, connectionId })
    await client.didcomm.offerCall({
      connectionId,
      callType: 'service',
      description: 'Start call',
      parameters: { wsUrl, roomId, peerId: connectionId },
    })
  } catch (reason) {
    logger.error(`Cannot create call: ${reason}`)
    await sendText(connectionId, 'An error has occurred while creating a call')
  }
}

const downloadAndDecipher = async (item: SharedMediaItem): Promise<Buffer> => {
  if (!item.uri) throw new Error('the item carries no uri')
  const response = await fetch(item.uri, { timeout: MEDIA_DOWNLOAD_TIMEOUT_MS })
  if (!response.ok) throw new Error(`the download of ${item.uri} answered HTTP ${response.status}`)
  const downloaded = await response.buffer()

  const ciphering = item.ciphering
  if (!ciphering) return downloaded
  if (ciphering.algorithm !== 'aes-256-cbc') throw new Error(`unsupported ciphering ${ciphering.algorithm}`)

  const key = Buffer.from(String(ciphering.parameters.key), 'hex')
  const iv = Buffer.from(String(ciphering.parameters.iv), 'hex')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([decipher.update(downloaded), decipher.final()])
}

const handleText = async (connectionId: string, content: string): Promise<void> => {
  logger.info(`Content: ${content}`)
  const [command] = content.split(/\s/)
  if (command === '/echo') {
    await sendText(connectionId, content.substring(5))
  } else if (command === '/echo-media') {
    const [, state] = content.split(' ')
    if (state !== 'on' && state !== 'off') {
      await sendText(connectionId, 'Usage: /echo-media on|off')
    } else {
      connectionSettings.set(connectionId, { ...settingsOf(connectionId), echoMedia: state === 'on' })
      await sendText(connectionId, `echo-media ${state}`)
    }
  } else if (command === '/trace') {
    const [, state] = content.split(' ')
    if (state !== 'on' && state !== 'off') {
      await sendText(connectionId, 'Usage: /trace on|off')
    } else {
      connectionSettings.set(connectionId, { ...settingsOf(connectionId), trace: state === 'on' })
      await sendText(connectionId, `trace ${state}`)
    }
  } else if (command === '/context') {
    await sendRootMenu(connectionId)
  } else if (command === '/menu') {
    await sendQuestion(connectionId, rootMenuAsQA)
  } else if (command === '/question') {
    const [, count] = content.split(' ')
    const optionCount = count ? Number(count) : DEFAULT_QUESTION_OPTIONS
    if (!Number.isInteger(optionCount) || optionCount < 1 || optionCount > MAXIMUM_QUESTION_OPTIONS) {
      await sendText(connectionId, `Usage: /question <n>, n from 1 to ${MAXIMUM_QUESTION_OPTIONS}`)
    } else {
      testQuestionThreadIds.add(await sendQuestion(connectionId, testQuestion(optionCount)))
    }
  } else if (command === '/media') {
    const [firstArgument, ...otherArguments] = content.substring(7).match(parameterRegExp) ?? []
    if (firstArgument && !mediaFixtures[firstArgument]) {
      const description = otherArguments.join(' ')
      await client.didcomm.shareMedia({
        connectionId,
        description: description || 'An image',
        items: [
          {
            description: description || 'Bunny',
            uri: firstArgument,
            mimeType: 'image/jpeg',
            fileName: `${randomUUID()}.jpg`,
            byteCount: 6576,
          },
        ],
      })
    } else {
      const fixture = mediaFixtures[firstArgument ?? 'image']
      await client.didcomm.shareMedia({
        connectionId,
        description: fixture.description,
        items: [
          {
            description: fixture.description,
            uri: `${PUBLIC_BASE_URL}/${fixture.fileName}`,
            mimeType: fixture.mimeType,
            fileName: fixture.fileName,
            byteCount: statSync(path.join(staticDir, fixture.fileName)).size,
            metadata: fixture.metadata,
          },
        ],
      })
      if (fixture.note) await sendText(connectionId, fixture.note)
    }
  } else if (command === '/link') {
    const parsedContents = content.substring(6).match(parameterRegExp)
    if (parsedContents) {
      await client.didcomm.shareMedia({
        connectionId,
        description: parsedContents[2],
        items: [
          {
            uri: parsedContents[0] || 'https://2060.io',
            mimeType: 'text/html',
            metadata: {
              title: parsedContents[1] || 'Title',
              icon: parsedContents[3] || '',
              openingMode: parsedContents[4] || 'normal',
            },
          },
        ],
      })
    }
  } else if (command === '/invitation') {
    const parameters = content.split(/\s+/).slice(1)
    const named = new Map<string, string>()
    for (const parameter of parameters) {
      const match = /^(did|label|image)=(.*)$/.exec(parameter)
      if (match) named.set(match[1], match[2])
    }
    if (named.size > 0) {
      await client.didcomm.createInvitation({
        connectionId,
        label: named.get('label') || undefined,
        imageUrl: named.get('image') || undefined,
        did: named.get('did') || undefined,
      })
    } else {
      const [label, imageUrl, did] = parameters
      await client.didcomm.createInvitation({ connectionId, label, imageUrl, did })
    }
  } else if (command === '/profile') {
    const [, displayName, image, icon] = content.split(' ')
    await client.didcomm.sendProfile({
      connectionId,
      profile: {
        displayName,
        displayPicture: image ? { links: [image] } : undefined,
        displayIcon: icon ? { links: [icon] } : undefined,
      },
    })
  } else if (command === '/call') {
    const [, wsUrl, roomId] = content.split(' ')
    await offerCall(connectionId, wsUrl, roomId)
  } else if (command === '/mrz') {
    await client.didcomm.requestMrz({ connectionId })
  } else if (command === '/emrtd') {
    await client.didcomm.requestEmrtdData({ connectionId })
  } else if (command === '/revoke') {
    const [, credentialExchangeId] = content.split(' ')
    if (!credentialExchangeId) {
      await sendText(connectionId, 'Usage: /revoke <credentialExchangeId>')
    } else {
      await revokeCredential(connectionId, credentialExchangeId)
    }
  } else if (command === '/issue') {
    const [, phoneNumber] = content.split(' ')
    await issueCredential(connectionId, phoneNumber)
  } else if (command === '/proof') {
    await requestProof(connectionId)
  } else if (command === '/rocky') {
    await sendText(connectionId, rockyQuotes[Math.floor(Math.random() * rockyQuotes.length)])
  } else if (command === '/help') {
    await sendText(connectionId, helpMessage)
  } else if (command === '/terminate') {
    await client.didcomm.deleteConnection(connectionId)
  } else {
    await sendText(connectionId, 'I do not understand what you say. Write /help to get available commands')
  }
}

events
  .on('didcomm.connections.state-updated', async data => {
    logger.info(`connection state updated: ${JSON.stringify(data)}`)
    if (data.state === 'completed' && data.previousState !== 'completed') {
      await sendRootMenu(data.id)
      await sendText(data.id, welcomeMessage)
    }
  })
  .on('didcomm.basic-messages.message-received', async data => {
    logger.info(`received message: ${JSON.stringify(data)}`)
    await handleText(data.connectionId, data.content)
  })
  .on('didcomm.receipts.message-receipts-received', async data => {
    for (const receipt of data.receipts ?? []) {
      if (tracedMessageIds.has(receipt.messageId)) continue
      await sendTrace(data.connectionId, `receipt ${receipt.state} ${receipt.messageId}`)
    }
  })
  .on('didcomm.user-profile.profile-received', async data => {
    await sendTrace(data.connectionId, `profile ${data.profile.displayName ?? ''}`)
  })
  .on('didcomm.question-answer.answer-received', async data => {
    await sendTrace(data.connectionId, `answer ${data.response}`)
    if (testQuestionThreadIds.delete(data.threadId)) return

    const item = [...worldCupPoll.menuItems, ...rootMenuAsQA.menuItems].find(
      menuItem => menuItem.text === data.response,
    )
    await handleMenuSelection(data.connectionId, item?.id ?? data.response)
  })
  .on('didcomm.action-menu.perform-received', async data => {
    await sendTrace(data.connectionId, `menu ${data.name}`)
    await handleMenuSelection(data.connectionId, data.name)
  })
  .on('didcomm.presentations.state-updated', async data => {
    if (data.role !== 'verifier') return
    const connectionId = proofRequests.get(data.proofExchangeId)
    if (!connectionId) {
      logger.warn(`No chat connection for proof exchange ${data.proofExchangeId}`)
      return
    }
    if (data.state === 'done') {
      proofRequests.delete(data.proofExchangeId)
      await sendText(
        connectionId,
        `We have successfully received your proof submission. Verified: ${data.verified}. Enjoy the service!`,
      )
    } else if (data.state === 'abandoned' || data.state === 'declined') {
      proofRequests.delete(data.proofExchangeId)
      await sendText(connectionId, `Proof request ${data.state}: ${data.errorMessage ?? 'no details'}`)
    }
  })
  .on('didcomm.credential-exchanges.state-updated', async data => {
    if (data.role !== 'issuer' || data.state !== 'done') return
    const issued = issuedCredentials.get(data.credentialExchangeId)
    if (!issued) {
      logger.warn(`No chat connection for credential exchange ${data.credentialExchangeId}`)
      return
    }
    await sendText(
      issued.connectionId,
      `For revocation, please provide the exchange id: ${data.credentialExchangeId}`,
    )
  })
  .on('didcomm.mrtd.mrz-data-received', async data => {
    logger.info(`MRZ data received: ${JSON.stringify(data.mrzData)}`)
    await client.didcomm.requestEmrtdData({ connectionId: data.connectionId })
  })
  .on('didcomm.mrtd.emrtd-data-received', data => {
    logger.info(`eMRTD data received: ${JSON.stringify(data.dataGroups)}`)
  })
  .on('didcomm.mrtd.problem-report-received', async data => {
    await sendText(data.connectionId, `Problem: ${data.reason}`)
  })
  .on('didcomm.media-sharing.share-media-received', async data => {
    logger.info(`media received: ${JSON.stringify(data.items)}`)
    const { echoMedia } = settingsOf(data.connectionId)
    for (const item of data.items ?? []) {
      let plain: Buffer
      try {
        plain = await downloadAndDecipher(item)
      } catch (error) {
        logger.error(`Cannot read the received media: ${error}`)
        await sendText(data.connectionId, `media-error ${error instanceof Error ? error.message : error}`)
        continue
      }

      const digest = createHash('sha256').update(plain).digest('hex')
      await sendText(data.connectionId, `media-received ${item.mimeType} ${plain.length} sha256:${digest}`)

      if (echoMedia) {
        await client.didcomm.shareMedia({
          connectionId: data.connectionId,
          description: data.description,
          items: [
            {
              uri: item.uri,
              mimeType: item.mimeType,
              fileName: item.fileName,
              description: item.description,
              byteCount: item.byteCount,
              ciphering: item.ciphering,
              metadata: item.metadata,
            },
          ],
        })
      }
    }
  })
  .on('didcomm.reactions.message-reactions-received', async data => {
    for (const reaction of data.reactions ?? []) {
      const line = `reaction ${reaction.action} ${reaction.emoji} ${reaction.messageId}`
      await sendTrace(data.connectionId, line)
    }

    const first = data.reactions?.[0]
    if (first?.action !== 'react') return
    await client.didcomm.sendReactions({
      connectionId: data.connectionId,
      reactions: [{ messageId: first.messageId, emoji: '❤️', action: 'react' }],
    })
  })

const describeApiFailure = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'the VS Agent admin API is unreachable'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, character => `&#${character.charCodeAt(0)};`)

const qrPage = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { font-family: sans-serif; text-align: center; margin: 2rem }
svg { width: min(80vw, 400px); height: auto }
code { word-break: break-all }
</style>
</head>
<body>
<h1>${title}</h1>
${body}
</body>
</html>
`

app.get('/invitation', async (req: Request, res: Response): Promise<void> => {
  const label = typeof req.query.label === 'string' ? req.query.label : undefined
  const forLabel = label ? ` for ${label}` : ''
  try {
    const invitation = await client.didcomm.createInvitation({})
    logger.info(`invitation ${invitation.id} created${forLabel}`)
    res.json({ url: invitation.shortUrl, invitationId: invitation.id })
  } catch (error) {
    logger.error(`Cannot create an invitation${forLabel}: ${error}`)
    res.status(503).json({ error: describeApiFailure(error) })
  }
})

app.get('/qr', async (_req: Request, res: Response): Promise<void> => {
  try {
    const invitation = await client.didcomm.createInvitation({ reusable: true })
    if (!invitation.shortUrl) {
      logger.error(`Invitation ${invitation.id} carries no short URL`)
      res
        .status(503)
        .send(qrPage('No QR code', '<p>The agent created the invitation without a short URL.</p>'))
      return
    }
    logger.info(`invitation ${invitation.id} created for the QR page`)
    const svg = await QRCode.toString(invitation.shortUrl, { type: 'svg' })
    const url = escapeHtml(invitation.shortUrl)
    res.send(
      qrPage(
        'Chat with the demo chatbot',
        `${svg}
<p><a href="${url}"><code>${url}</code></a></p>
<p>This invitation is reusable, so any number of wallets can scan the code.</p>
<p><a href="/qr">Get another invitation</a></p>`,
      ),
    )
  } catch (error) {
    logger.error(`Cannot create an invitation for the QR page: ${error}`)
    res.status(503).send(qrPage('No QR code', `<p>${escapeHtml(describeApiFailure(error))}</p>`))
  }
})

app.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    await client.agent.getReadiness()
    const { version } = await client.agent.getAgentInfo()
    res.json({ status: 'ok', chatbotVersion: packageJson.version, vsAgentVersion: version })
  } catch (error) {
    logger.warn(`Health check failed: ${error}`)
    res
      .status(503)
      .json({ status: 'error', chatbotVersion: packageJson.version, reason: describeApiFailure(error) })
  }
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

app.post('/call-events', async (req: Request, res: Response): Promise<void> => {
  logger.info(`Event received: ${JSON.stringify(req.body)}`)
  const event = req.body.event
  const call = ongoingCalls.find(item => item.connectionId === req.body.peerId)

  if (!call) {
    logger.warn('No call matching the event')
    res.end()
    return
  }

  if (event === 'peer-joined') {
    const body = JSON.stringify({
      ws_url: `${call.wsUrl}/?roomId=${call.roomId}&peerId=${randomUUID()}`,
      success_url: `${PUBLIC_BASE_URL}/call-success/${call.connectionId}`,
      failure_url: `${PUBLIC_BASE_URL}/call-failure/${call.connectionId}`,
    })
    logger.info(`join-call parameters: ${body}`)
    await fetch(`${VISION_SERVICE_BASE_URL}/join-call`, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      body,
    })
  } else if (event === 'peer-left') {
    ongoingCalls.splice(ongoingCalls.indexOf(call), 1)
  }
  res.end()
})

app.put('/call-success/:connectionId', (req: Request, res: Response): void => {
  logger.info(`Call success for ${req.params.connectionId}: ${JSON.stringify(req.body)}`)
  res.end()
  sendText(req.params.connectionId, 'Call was succesful').catch(error =>
    logger.error(`Cannot send message: ${error}`),
  )
})

app.put('/call-failure/:connectionId', (req: Request, res: Response): void => {
  logger.info(`Call failure for ${req.params.connectionId}: ${JSON.stringify(req.body)}`)
  res.end()
  sendText(req.params.connectionId, 'Call failed').catch(error =>
    logger.error(`Cannot send message: ${error}`),
  )
})

export { app, server }
