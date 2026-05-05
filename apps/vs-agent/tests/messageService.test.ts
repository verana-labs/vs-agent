import { PictureData } from '@2060.io/credo-ts-didcomm-user-profile'
import { DidCommBasicMessage, DidCommConnectionRecord } from '@credo-ts/didcomm'
import { INestApplication } from '@nestjs/common'
import { ProfileMessage, TextMessage } from '@verana-labs/vs-agent-model'
import {
  SubjectInboundTransport,
  SubjectOutboundTransport,
  type BaseAgentModules,
  type SubjectMessage,
  type VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { MessageService } from '../src/controllers'

import {
  isAgentMessageProcessedEvent,
  isConnectionProfileUpdatedEvent,
  makeConnection,
  startAgent,
  startServersTesting,
  waitForEvent,
} from './__mocks__'

describe('MessageService', () => {
  let faberApp: INestApplication
  let aliceApp: INestApplication
  let faberService: MessageService
  let aliceService: MessageService
  const faberMessages = new Subject<SubjectMessage>()
  const aliceMessages = new Subject<SubjectMessage>()
  const subjectMap = {
    'rxjs:faber': faberMessages,
    'rxjs:alice': aliceMessages,
  }
  let faberAgent: VsAgent<BaseAgentModules>
  let aliceAgent: VsAgent<BaseAgentModules>
  let faberConnection: DidCommConnectionRecord
  let aliceConnection: DidCommConnectionRecord
  let faberEvents: ReturnType<typeof vi.spyOn>
  let aliceEvents: ReturnType<typeof vi.spyOn>

  describe('Testing for message exchange with VsAgent', async () => {
    beforeEach(async () => {
      faberAgent = await startAgent({ label: 'Faber Test', domain: 'faber' })
      faberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
      faberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      await faberAgent.initialize()
      faberEvents = vi.spyOn(faberAgent.events, 'emit')
      faberApp = await startServersTesting(faberAgent)

      aliceAgent = await startAgent({ label: 'Alice Test', domain: 'alice' })
      aliceAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(aliceMessages))
      aliceAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      await aliceAgent.initialize()
      ;[aliceConnection, faberConnection] = await makeConnection(aliceAgent, faberAgent)
      aliceEvents = vi.spyOn(aliceAgent.events, 'emit')
      aliceApp = await startServersTesting(aliceAgent)

      faberService = faberApp.get<MessageService>(MessageService)
      aliceService = aliceApp.get<MessageService>(MessageService)
    })

    afterEach(async () => {
      await faberApp.close()
      await aliceApp.close()
      await faberAgent.shutdown()
      await aliceAgent.shutdown()
      vi.restoreAllMocks()
    })

    it('should allow Alice and Faber to exchange a structured conversational flow.', async () => {
      // vars
      const msgFaber = 'Hello'
      const msgAlice = 'How are you?'

      // Create wait event
      const faberPromise = waitForEvent(faberEvents, isAgentMessageProcessedEvent)
      const alicePromise = waitForEvent(aliceEvents, isAgentMessageProcessedEvent)

      // Send messages
      await aliceService.sendMessage(
        { type: 'text', content: msgFaber, connectionId: aliceConnection.id } as TextMessage,
        aliceConnection,
      )
      await faberService.sendMessage(
        { type: 'text', content: msgAlice, connectionId: faberConnection.id } as TextMessage,
        faberConnection,
      )

      // Receiving messages
      const msgToFaber = await faberPromise
      const msgToAlice = await alicePromise

      // expects
      expect((msgToFaber.payload.message as DidCommBasicMessage)?.content).toBe(msgFaber)
      expect((msgToAlice.payload.message as DidCommBasicMessage)?.content).toBe(msgAlice)
    })

    it('Should Faber send a profile update message to Alice.', async () => {
      // vars
      const displayImageUrl = 'https://testing.png'
      const description = 'Testing image link'

      // Create wait event
      const alicePromise = waitForEvent(aliceEvents, isConnectionProfileUpdatedEvent)

      // Send messages
      await faberService.sendMessage(
        {
          type: 'profile',
          connectionId: faberConnection.id,
          displayImageUrl,
          description,
        } as ProfileMessage,
        faberConnection,
      )

      // Receiving messages
      const {
        payload: { connection, profile },
      } = await alicePromise

      // expects
      expect(connection.id).toBe(aliceConnection.id)
      expect((profile.displayPicture as PictureData)?.links?.[0]).toBe(displayImageUrl)
      expect(profile.description).toBe(description)
    })
  })
})
