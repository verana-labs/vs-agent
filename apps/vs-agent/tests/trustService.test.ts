import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import { INestApplication } from '@nestjs/common'
import { Claim, CredentialIssuanceMessage } from '@verana-labs/vs-agent-model'
import {
  SubjectInboundTransport,
  SubjectOutboundTransport,
  type BaseAgentModules,
  type SubjectMessage,
  type VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import request from 'supertest'
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'

import { MessageService, TrustService } from '../src/controllers'

import {
  isCredentialStateChangedEvent,
  makeConnection,
  startAgent,
  startServersTesting,
  waitForEvent,
} from './__mocks__'

describe('TrustService', () => {
  let faberApp: INestApplication
  let faberService: TrustService
  let faberMsgService: MessageService
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
  let aliceEvents: ReturnType<typeof vi.spyOn>

  describe('JSC creation and DID document references', () => {
    let jscFaberApp: INestApplication
    let jscFaberService: TrustService
    let jscFaberAgent: VsAgent<BaseAgentModules>

    beforeEach(async () => {
      jscFaberAgent = await startAgent({ label: 'Faber JSC Test', domain: 'faber' })
      jscFaberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
      jscFaberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      await jscFaberAgent.initialize()
      jscFaberApp = await startServersTesting(jscFaberAgent)
      jscFaberService = jscFaberApp.get<TrustService>(TrustService)
    })

    afterEach(async () => {
      await jscFaberApp.close()
      await jscFaberAgent.shutdown()
      vi.restoreAllMocks()
    })

    it('should add a service reference to the DID document after creating a JSC', async () => {
      await jscFaberService.createJsc(
        'org-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
      )

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const services = didRecord.didDocument?.service ?? []
      const serviceId = `${jscFaberAgent.did}#vpr-schemas-org-schema-jsc-vp`

      expect(services.some(s => s.id === serviceId)).toBe(true)
    })

    it('should not create duplicate service references when the same JSC is created twice', async () => {
      const schemaBaseId = 'org-schema'
      const jsonSchemaRef = 'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org'

      await jscFaberService.createJsc(schemaBaseId, jsonSchemaRef)
      await jscFaberService.createJsc(schemaBaseId, jsonSchemaRef)

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const services = didRecord.didDocument?.service ?? []
      const serviceId = `${jscFaberAgent.did}#vpr-schemas-org-schema-jsc-vp`
      const matchingServices = services.filter(s => s.id === serviceId)

      expect(matchingServices).toHaveLength(1)
    })

    it('should maintain independent service references for different JSC schemas', async () => {
      await jscFaberService.createJsc(
        'org-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-org',
      )
      await jscFaberService.createJsc(
        'service-schema',
        'https://dm.chatbot.demos.dev.2060.io/vt/cs/v1/js/ecs-service',
      )

      const [didRecord] = await jscFaberAgent.dids.getCreatedDids({ did: jscFaberAgent.did })
      const services = didRecord.didDocument?.service ?? []
      const orgServiceId = `${jscFaberAgent.did}#vpr-schemas-org-schema-jsc-vp`
      const svcServiceId = `${jscFaberAgent.did}#vpr-schemas-service-schema-jsc-vp`

      expect(services.filter(s => s.id === orgServiceId)).toHaveLength(1)
      expect(services.filter(s => s.id === svcServiceId)).toHaveLength(1)
    })
  })

  describe('Testing for message exchange with VsAgent', async () => {
    beforeEach(async () => {
      faberAgent = await startAgent({ label: 'Faber Test', domain: 'faber' })
      faberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
      faberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      await faberAgent.initialize()
      faberApp = await startServersTesting(faberAgent)

      aliceAgent = await startAgent({ label: 'Alice Test', domain: 'alice' })
      aliceAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(aliceMessages))
      aliceAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
      await aliceAgent.initialize()
      ;[aliceConnection, faberConnection] = await makeConnection(aliceAgent, faberAgent)
      aliceEvents = vi.spyOn(aliceAgent.events, 'emit')
      await startServersTesting(aliceAgent)

      faberService = faberApp.get<TrustService>(TrustService)
      faberMsgService = faberApp.get<MessageService>(MessageService)
    })

    afterEach(async () => {
      await faberApp.close()
      await faberAgent.shutdown()
      await aliceAgent.shutdown()
      vi.restoreAllMocks()
    })

    it('should issue a JSON-LD credential with a valid Ed25519 proof', async () => {
      const credentialResponse = await faberService.issueCredential({
        format: 'jsonld',
        did: 'did:web:example.com',
        jsonSchemaCredentialId: 'https://example.org/vt/schemas-example-org-jsc.json',
        claims: {
          id: 'https://example.org/org/123',
          name: 'OpenAI Research',
          logo: 'https://example.com/logo.png',
          registryId: 'REG-123',
          registryUrl: 'https://registry.example.org',
          address: '123 Main St, San Francisco, CA',
          type: 'PRIVATE',
          countryCode: 'US',
        },
      })
      expect(credentialResponse.credential!.proof).toEqual(
        expect.objectContaining({
          type: 'Ed25519Signature2020',
          verificationMethod: expect.any(String),
          created: expect.any(String),
          proofPurpose: 'assertionMethod',
          proofValue: expect.any(String),
        }),
      )
    })

    it('should issue a valid anoncreds credential', async () => {
      // Mocks
      const original = WebVhAnonCredsRegistry.prototype['_resolveAndValidateAttestedResource']
      vi.spyOn(
        WebVhAnonCredsRegistry.prototype as any,
        '_resolveAndValidateAttestedResource',
      ).mockImplementation(async function (...args: any[]) {
        const resourceId = args[1]
        if (resourceId.includes(':faber/')) {
          const cid = resourceId.split('/').pop()
          const res = await request(faberApp.getHttpServer()).get(`/resources/${cid}`)
          if (res.status !== 200) {
            throw new Error(`resource ${cid} not found in test server`)
          }
          return {
            resolutionResult: {
              content: res.body,
            },
            resourceObject: res.body,
          }
        }
        return original.call(this, ...args)
      })

      const claims = {
        id: 'https://example.org/org/123',
        name: 'OpenAI Research',
        logo: 'https://example.com/logo.png',
        registryId: 'REG-123',
        registryUrl: 'https://registry.example.org',
        address: '123 Main St, San Francisco, CA',
        type: 'PRIVATE',
        countryCode: 'US',
      }
      const credentialResponse = await faberService.issueCredential({
        format: 'anoncreds',
        jsonSchemaCredentialId: 'https://example.org/vt/schemas-example-org-jsc.json',
        claims,
      })

      // Create wait event
      const alicePromise = waitForEvent(aliceEvents, isCredentialStateChangedEvent)

      const record = await faberMsgService.sendMessage(
        {
          type: 'credential-issuance',
          connectionId: faberConnection.id,
          claims: Object.entries(claims).map(([name, value]) => new Claim({ name, value: String(value) })),
          jsonSchemaCredentialId: credentialResponse.jsonSchemaCredentialId,
        } as CredentialIssuanceMessage,
        faberConnection,
      )

      // Receiving messages
      const {
        payload: { credentialExchangeRecord },
      } = await alicePromise

      // expects
      expect(credentialExchangeRecord).toEqual(
        expect.objectContaining({
          state: 'offer-received',
          connectionId: aliceConnection.id,
          type: 'CredentialRecord',
          role: 'holder',
          protocolVersion: 'v2',
          id: expect.any(String),
          threadId: expect.any(String),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      )
      expect(record.id).toEqual(credentialExchangeRecord.threadId)
      expect(credentialResponse).toEqual(
        expect.objectContaining({
          status: 200,
          didcommInvitationUrl: expect.any(String),
          jsonSchemaCredentialId: expect.any(String),
        }),
      )
    }, 20000)
  })
})
