import { DidRepository } from '@credo-ts/core'
import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import { type VsAgent, type VsAgentConnectionStateEvent, VsAgentEventTypes } from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startAgent } from './__mocks__'
import { FakeDidResolver } from './__mocks__/fakeDidResolver'
import { SubjectInboundTransport, SubjectOutboundTransport, type SubjectMessage } from './helpers'

const vsAgentConnectionCompleted = (agent: VsAgent<any>) =>
  new Promise<void>(resolve =>
    agent.events.on<VsAgentConnectionStateEvent>(VsAgentEventTypes.ConnectionStateUpdated, ({ payload }) => {
      if (payload.event.state === DidCommDidExchangeState.Completed) resolve()
    }),
  )

/**
 * A DIDComm v1 peer starts DID Exchange with an implicit invitation to the public DID of the
 * agent. The agent is configured with a did:webvh that has no SCID, as the Helm chart does.
 */
describe('implicit invitation: DID Exchange request to the public DID', () => {
  let service: VsAgent<any>
  let client: VsAgent<any>

  beforeEach(async () => {
    // A new resolver for each test: it resolves did:web by domain, and each test creates a new 'service' DID
    const sharedResolver = new FakeDidResolver()
    const serviceMessages = new Subject<SubjectMessage>()
    const clientMessages = new Subject<SubjectMessage>()
    const subjectMap = {
      'rxjs:service': serviceMessages,
      'rxjs:client': clientMessages,
    }

    service = await startAgent({ label: 'Service', domain: 'service', didcommVersions: ['v1'] })
    service.didcomm.registerInboundTransport(new SubjectInboundTransport(serviceMessages))
    service.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    service.dids.config.resolvers.unshift(sharedResolver)
    await service.initialize()
    await sharedResolver.registerAgent(service)

    client = await startAgent({ label: 'Client', domain: 'client', didcommVersions: ['v1'] })
    client.didcomm.registerInboundTransport(new SubjectInboundTransport(clientMessages))
    client.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    client.dids.config.resolvers.unshift(sharedResolver)
    await client.initialize()
  }, 30_000)

  afterEach(async () => {
    await client?.shutdown()
    await service?.shutdown()
  })

  const connectTo = async (did: string) => {
    // The connection listeners of vs-agent run after the state change. Wait until both agents
    // finish them, so that no listener reads the storage during shutdown.
    const completed = [service, client].map(agent => vsAgentConnectionCompleted(agent))
    const { connectionRecord } = await client.didcomm.oob.receiveImplicitInvitation({
      did,
      label: client.label,
      autoAcceptConnection: true,
    })
    if (!connectionRecord) throw new Error(`No connection record for implicit invitation to ${did}`)
    const connection = await client.didcomm.connections.returnWhenIsConnected(connectionRecord.id, {
      timeoutMs: 10_000,
    })
    await Promise.all(completed)
    return connection
  }

  const servicePublicDid = () => {
    if (!service.did) throw new Error('The service has no public DID')
    return service.did
  }

  it('accepts a request to the did:webvh', async () => {
    expect(service.did).toMatch(/^did:webvh:[^:]+:service$/)

    const connection = await connectTo(servicePublicDid())

    expect(connection.isReady).toBe(true)
  }, 15_000)

  it('accepts a request to the did:web alternative', async () => {
    // The agent adds the did:web alternative when it starts with an existing DID record
    const didRepository = service.context.dependencyManager.resolve(DidRepository)
    const didRecord = await didRepository.findCreatedDid(service.context, servicePublicDid())
    if (!didRecord) throw new Error(`No DID record for ${service.did}`)
    didRecord.setTag('alternativeDids', ['did:web:service'])
    await didRepository.update(service.context, didRecord)

    const connection = await connectTo('did:web:service')

    expect(connection.isReady).toBe(true)
  }, 15_000)
})
