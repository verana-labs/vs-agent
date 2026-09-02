import type { INestApplication } from '@nestjs/common'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

// The AnonCreds binding adds itself to the shared module on import.
import '@hyperledger/anoncreds-nodejs'

import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Subject } from 'rxjs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'
import { PublicModule } from '../src/public.module'

import { startAgent } from './__mocks__'
import { FakeDidResolver } from './__mocks__/fakeDidResolver'
import { SubjectInboundTransport, SubjectOutboundTransport, type SubjectMessage } from './helpers'

const PUBLIC_API_BASE_URL = 'http://localhost:3001'

async function startAdminApi(agent: VsAgent<BaseAgentModules>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      VsAgentModule.register(agent, PUBLIC_API_BASE_URL, []),
      PublicModule.register(agent, PUBLIC_API_BASE_URL),
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(new ValidationPipe())
  app.useGlobalFilters(new ErrorEnvelopeFilter(app.get(HttpAdapterHost).httpAdapter))
  await app.init()

  return app
}

/**
 * Two agents run the DIDComm protocols. Each caller declines its own step with the
 * Administration API. Refer to [VSA-ADM-DC-PR-DECLINE] and [VSA-ADM-DC-CE-DECLINE].
 *
 * Faber is the verifier and the issuer. Alice is the prover and the holder. The test reads the
 * state of the two agents after each decline. The caller gets `declined`. The peer gets
 * `abandoned`, because a problem report is a failure for the peer.
 */

const JSON_SCHEMA_CREDENTIAL_ID = 'https://example.org/vt/schemas-example-org-jsc.json'

const claims = [
  { name: 'id', value: 'https://example.org/org/123' },
  { name: 'name', value: 'OpenAI Research' },
  { name: 'logoUri', value: 'https://example.com/logo.png' },
  { name: 'logoDigestSri', value: 'sha384-AAAA' },
  { name: 'registryId', value: 'REG-123' },
  { name: 'registryUri', value: 'https://registry.example.org' },
  { name: 'address', value: '123 Main St, San Francisco, CA' },
  { name: 'organizationKind', value: 'PRIVATE' },
  { name: 'countryCode', value: 'US' },
  { name: 'legalJurisdiction', value: 'US-CA' },
  { name: 'lei', value: '5493001KJTIIGC8Y1R12' },
]

const faberMessages = new Subject<SubjectMessage>()
const aliceMessages = new Subject<SubjectMessage>()
const subjectMap = { 'rxjs:faber': faberMessages, 'rxjs:alice': aliceMessages }

describe('v2 didcomm decline routes, over two agents', () => {
  let faberAgent: VsAgent<BaseAgentModules>
  let aliceAgent: VsAgent<BaseAgentModules>
  let faberApp: INestApplication
  let aliceApp: INestApplication
  let credentialDefinitionId: string

  const resolver = new FakeDidResolver()

  const faber = () => request(faberApp.getHttpServer())
  const alice = () => request(aliceApp.getHttpServer())

  beforeAll(async () => {
    faberAgent = await startAgent({ label: 'Faber', domain: 'faber' })
    faberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
    faberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    faberAgent.dids.config.resolvers.unshift(resolver)
    await faberAgent.initialize()
    faberApp = await startAdminApi(faberAgent)

    aliceAgent = await startAgent({ label: 'Alice', domain: 'alice' })
    aliceAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(aliceMessages))
    aliceAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    aliceAgent.dids.config.resolvers.unshift(resolver)
    await aliceAgent.initialize()
    aliceApp = await startAdminApi(aliceAgent)

    // No DID is on a reachable host. Each agent resolves the other from memory.
    await resolver.registerAgent(faberAgent)
    await resolver.registerAgent(aliceAgent)

    // Alice reads the AnonCreds resources of Faber from the test server of Faber. The test
    // replaces a private method of the registry, thus the prototype needs a loose type.
    const registryPrototype = WebVhAnonCredsRegistry.prototype as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >
    const original = registryPrototype._resolveAndValidateAttestedResource
    vi.spyOn(registryPrototype, '_resolveAndValidateAttestedResource').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const resourceId = args[1] as string
      if (resourceId.includes(':faber/')) {
        const cid = resourceId.split('/').pop()
        const response = await faber().get(`/resources/${cid}`)
        if (response.status !== 200) throw new Error(`resource ${cid} is absent from the test server`)
        return { resolutionResult: { content: response.body }, resourceObject: response.body }
      }
      return original.call(this, ...args)
    })

    const credentialDefinition = await faber()
      .post('/v2/anoncreds/credential-definitions')
      .send({ relatedJsonSchemaCredentialId: JSON_SCHEMA_CREDENTIAL_ID })
    expect(credentialDefinition.status).toBe(201)
    credentialDefinitionId = credentialDefinition.body.id
  }, 120_000)

  afterAll(async () => {
    await faberApp?.close()
    await aliceApp?.close()
    await faberAgent?.shutdown()
    await aliceAgent?.shutdown()
    vi.restoreAllMocks()
  })

  type Collection = 'presentations' | 'credential-exchanges'

  const idKey = (collection: Collection) =>
    collection === 'presentations' ? 'proofExchangeId' : 'credentialExchangeId'

  async function recordsOf(app: INestApplication, collection: Collection): Promise<Record<string, string>[]> {
    const response = await request(app.getHttpServer()).get(`/v2/didcomm/${collection}?limit=500`)
    return response.body.items ?? []
  }

  async function idsOf(app: INestApplication, collection: Collection): Promise<Set<string>> {
    const records = await recordsOf(app, collection)
    return new Set(records.map(record => record[idKey(collection)]))
  }

  /** Waits for a record that the given identifiers do not name. A message from the peer makes it. */
  async function untilNewRecord(
    app: INestApplication,
    collection: Collection,
    state: string,
    known: Set<string>,
  ): Promise<string> {
    for (let attempt = 0; attempt < 80; attempt++) {
      const records = await recordsOf(app, collection)
      const match = records.find(record => record.state === state && !known.has(record[idKey(collection)]))
      if (match) return match[idKey(collection)]
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`no new ${collection} record reached state "${state}"`)
  }

  async function untilRecordState(
    app: INestApplication,
    collection: Collection,
    id: string,
    state: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 80; attempt++) {
      const response = await request(app.getHttpServer()).get(`/v2/didcomm/${collection}/${id}`)
      if (response.body.state === state) return
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`${collection} record "${id}" did not reach state "${state}"`)
  }

  it('declines a received presentation request, and the verifier abandons the exchange', async () => {
    const created = await faber()
      .post('/v2/didcomm/presentation-request')
      .send({ requestedCredentials: [{ credentialDefinitionId, attributes: ['name'] }] })
    expect(created.status).toBe(201)
    const faberProofId = created.body.proofExchangeId

    const known = await idsOf(aliceApp, 'presentations')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(created.body.url, { label: aliceAgent.label })
    const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

    const declined = await alice()
      .post(`/v2/didcomm/presentations/${aliceProofId}/decline`)
      .send({ reason: 'the holder refuses to present' })

    expect(declined.body.error ?? declined.status).toBe(200)
    expect(declined.body.state).toBe('declined')

    // The specification puts a problem report from a peer in `abandoned`, not in `declined`.
    await untilRecordState(faberApp, 'presentations', faberProofId, 'abandoned')

    const verifierRecord = await faber().get(`/v2/didcomm/presentations/${faberProofId}`)
    expect(verifierRecord.body.errorMessage).toContain('the holder refuses to present')
  }, 120_000)

  it('declines the verifier step, and reports that the peer does not get the problem report', async () => {
    const created = await faber()
      .post('/v2/didcomm/presentation-request')
      .send({ requestedCredentials: [{ credentialDefinitionId, attributes: ['name'] }] })
    expect(created.status).toBe(201)
    const faberProofId = created.body.proofExchangeId

    const known = await idsOf(aliceApp, 'presentations')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(created.body.url, { label: aliceAgent.label })
    const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

    const declined = await faber()
      .post(`/v2/didcomm/presentations/${faberProofId}/decline`)
      .send({ reason: 'the verifier withdraws the request' })

    expect(declined.body.error ?? declined.status).toBe(200)
    expect(declined.body.state).toBe('declined')

    // An invitation gives the record no connection. Credo then refuses to send the report, and
    // the record keeps the reason.
    expect(declined.body.errorMessage).toContain('could not notify the peer')

    // The state survives the write, so a later read gives the same record.
    const read = await faber().get(`/v2/didcomm/presentations/${faberProofId}`)
    expect(read.body.state).toBe('declined')

    // The peer gets no report, so it waits on its own step.
    const aliceRecord = await alice().get(`/v2/didcomm/presentations/${aliceProofId}`)
    expect(aliceRecord.body.state).toBe('request-received')

    const second = await faber().post(`/v2/didcomm/presentations/${faberProofId}/decline`)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('INVALID_STATE')
  }, 120_000)

  it('declines a received credential offer, and the issuer abandons the exchange', async () => {
    const offer = await faber().post('/v2/didcomm/credential-offer').send({ credentialDefinitionId, claims })
    expect(offer.status).toBe(201)
    const faberId = offer.body.credentialExchangeId

    const known = await idsOf(aliceApp, 'credential-exchanges')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(offer.body.url, { label: aliceAgent.label })
    const aliceId = await untilNewRecord(aliceApp, 'credential-exchanges', 'offer-received', known)

    const declined = await alice()
      .post(`/v2/didcomm/credential-exchanges/${aliceId}/decline`)
      .send({ reason: 'the holder refuses the credential' })

    expect(declined.body.error ?? declined.status).toBe(200)
    expect(declined.body.state).toBe('declined')

    await untilRecordState(faberApp, 'credential-exchanges', faberId, 'abandoned')

    const issuerRecord = await faber().get(`/v2/didcomm/credential-exchanges/${faberId}`)
    expect(issuerRecord.body.errorMessage).toContain('the holder refuses the credential')
  }, 120_000)

  it('declines the issuer step, and reports that the peer does not get the problem report', async () => {
    const offer = await faber().post('/v2/didcomm/credential-offer').send({ credentialDefinitionId, claims })
    expect(offer.status).toBe(201)
    const faberId = offer.body.credentialExchangeId

    const declined = await faber()
      .post(`/v2/didcomm/credential-exchanges/${faberId}/decline`)
      .send({ reason: 'the issuer withdraws the offer' })

    expect(declined.body.error ?? declined.status).toBe(200)
    expect(declined.body.state).toBe('declined')
    expect(declined.body.errorMessage).toContain('could not notify the peer')

    const read = await faber().get(`/v2/didcomm/credential-exchanges/${faberId}`)
    expect(read.body.state).toBe('declined')

    const second = await faber().post(`/v2/didcomm/credential-exchanges/${faberId}/decline`)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('INVALID_STATE')
  }, 120_000)
})
