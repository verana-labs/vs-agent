import { ApiClient, EventDispatcher, EventEnvelope } from '@verana-labs/vs-agent-client'
import cors from 'cors'
import { randomUUID } from 'crypto'
import express from 'express'
import type { Express, Request, Response } from 'express'
import fetch from 'node-fetch'
import path from 'path'
import { Logger } from 'tslog'

import { helpMessage, rockyQuotes, rootContextMenu, rootMenuAsQA, welcomeMessage, worldCupPoll } from './data'

const logger = new Logger()

const PORT = Number(process.env.PORT || 5000)
const VS_AGENT_ADMIN_BASE_URL = process.env.VS_AGENT_ADMIN_BASE_URL || 'http://localhost:3000'
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:5000'
const VISION_SERVICE_BASE_URL =
  process.env.VISION_SERVICE_BASE_URL || 'https://webrtc-pymediasoup-client-demo.dev.2060.io'
const WEBRTC_SERVER_BASE_URL = process.env.WEBRTC_SERVER_BASE_URL || 'https://dts-webrtc.dev.2060.io'
const CREDENTIAL_DEFINITION_ID = process.env.CREDENTIAL_DEFINITION_ID || undefined

const app: Express = express()
const client = new ApiClient(VS_AGENT_ADMIN_BASE_URL)
const events = new EventDispatcher()

const staticDir = path.join(__dirname, 'public')
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

const sendText = async (connectionId: string, content: string): Promise<void> => {
  await client.didcomm.sendBasicMessage({ connectionId, content })
}

const sendQuestion = async (
  connectionId: string,
  question: { prompt: string; menuItems: { id: string; text: string }[] },
): Promise<void> => {
  await client.didcomm.sendQuestion({
    connectionId,
    question: question.prompt,
    validResponses: question.menuItems.map(item => ({ text: item.text })),
  })
}

const issueCredential = async (connectionId: string): Promise<void> => {
  if (!CREDENTIAL_DEFINITION_ID) {
    await sendText(connectionId, 'Service not available')
    return
  }
  let index: number | undefined
  if (revocationRegistryDefinitionId) {
    revocationRegistryIndex += 1
    index = revocationRegistryIndex
  }
  const offer = await client.didcomm.createCredentialOffer({
    credentialDefinitionId: CREDENTIAL_DEFINITION_ID,
    claims: [{ name: 'phoneNumber', value: '+5712345678', mimeType: 'text/plain' }],
    revocationRegistryDefinitionId,
    revocationRegistryIndex: index,
    autoAccept: true,
  })
  issuedCredentials.set(offer.credentialExchangeId, {
    connectionId,
    revocationRegistryDefinitionId,
    revocationRegistryIndex: index,
  })
  await sendText(connectionId, `Open this link to receive your credential: ${offer.shortUrl}`)
}

const requestProof = async (connectionId: string): Promise<void> => {
  if (!CREDENTIAL_DEFINITION_ID) {
    await sendText(connectionId, 'Service not available')
    return
  }
  await sendText(connectionId, 'In order to start a new chat, we need some verifiable information from you')
  const request = await client.didcomm.createPresentationRequest({
    requestedCredentials: [{ credentialDefinitionId: CREDENTIAL_DEFINITION_ID, attributes: ['phoneNumber'] }],
    autoAccept: true,
  })
  proofRequests.set(request.proofExchangeId, connectionId)
  await sendText(connectionId, `Open this link to present your credential: ${request.shortUrl}`)
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

const handleText = async (connectionId: string, content: string): Promise<void> => {
  logger.info(`Content: ${content}`)
  if (content.startsWith('/echo')) {
    await sendText(connectionId, content.substring(5))
  } else if (content.startsWith('/context')) {
    await sendRootMenu(connectionId)
  } else if (content.startsWith('/menu')) {
    await sendQuestion(connectionId, rootMenuAsQA)
  } else if (content.startsWith('/media')) {
    const parsedContents = content.substring(7).match(parameterRegExp)
    const description = parsedContents?.slice(1).join(' ')
    await client.didcomm.shareMedia({
      connectionId,
      description: description || 'An image',
      items: [
        {
          description: description || 'Bunny',
          uri: parsedContents?.[0] ?? `${PUBLIC_BASE_URL}/bunny.jpeg`,
          mimeType: 'image/jpeg',
          fileName: `${randomUUID()}.jpg`,
          byteCount: 6576,
        },
      ],
    })
  } else if (content.startsWith('/link')) {
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
  } else if (content.startsWith('/profile')) {
    const [, displayName, image, icon] = content.split(' ')
    await client.didcomm.sendProfile({
      connectionId,
      profile: {
        displayName,
        displayPicture: image ? { links: [image] } : undefined,
        displayIcon: icon ? { links: [icon] } : undefined,
      },
    })
  } else if (content.startsWith('/call')) {
    const [, wsUrl, roomId] = content.split(' ')
    await offerCall(connectionId, wsUrl, roomId)
  } else if (content.startsWith('/mrz')) {
    await client.didcomm.requestMrz({ connectionId })
  } else if (content.startsWith('/emrtd')) {
    await client.didcomm.requestEmrtdData({ connectionId })
  } else if (content.startsWith('/revoke')) {
    const [, credentialExchangeId] = content.split(' ')
    if (!credentialExchangeId) {
      await sendText(connectionId, 'Usage: /revoke <credentialExchangeId>')
    } else {
      await revokeCredential(connectionId, credentialExchangeId)
    }
  } else if (content.startsWith('/proof')) {
    await requestProof(connectionId)
  } else if (content.startsWith('/rocky')) {
    await sendText(connectionId, rockyQuotes[Math.floor(Math.random() * rockyQuotes.length)])
  } else if (content.startsWith('/help')) {
    await sendText(connectionId, helpMessage)
  } else if (content.startsWith('/terminate')) {
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
  .on('didcomm.question-answer.answer-received', async data => {
    const item = [...worldCupPoll.menuItems, ...rootMenuAsQA.menuItems].find(
      menuItem => menuItem.text === data.response,
    )
    await handleMenuSelection(data.connectionId, item?.id ?? data.response)
  })
  .on('didcomm.action-menu.perform-received', async data => {
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
  .on('didcomm.media-sharing.share-media-received', data => {
    logger.info(`media received: ${JSON.stringify(data.items)}`)
  })
  .on('didcomm.reactions.message-reactions-received', async data => {
    const first = data.reactions?.[0]
    if (first?.action !== 'react') return
    await client.didcomm.sendReactions({
      connectionId: data.connectionId,
      reactions: [{ messageId: first.messageId, emoji: '❤️', action: 'react' }],
    })
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
