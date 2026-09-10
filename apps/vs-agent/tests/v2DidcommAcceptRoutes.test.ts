import type { INestApplication } from '@nestjs/common'
import type { BaseAgentModules, VsAgent } from '@verana-labs/vs-agent-sdk'

// The holder builds its credential request with the native AnonCreds binding, which registers
// itself into the shared module on import.
import '@hyperledger/anoncreds-nodejs'

import { LogLevel } from '@credo-ts/core'
import {
  DidCommMessageSender,
  DidCommPresentationV2AckMessage,
  DidCommPresentationV2ProblemReportMessage,
} from '@credo-ts/didcomm'
import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Subject } from 'rxjs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createInvitation,
  createJsc,
  ParticipantRole,
  ParticipantState,
  REQUESTED_CREDENTIAL_SCHEMAS_METADATA,
  VeranaIndexerService,
  type VeranaChainService,
} from '@verana-labs/vs-agent-sdk'

import { VsAgentModule } from '../src/admin.module'
import { ErrorEnvelopeFilter } from '../src/common'
import { PublicModule } from '../src/public.module'
import { TsLogger } from '../src/utils'

import { issueVtjscFrom, mockResponses, startAgent } from './__mocks__'
import { FakeDidResolver } from './__mocks__/fakeDidResolver'
import {
  invitationUrl,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  type SubjectMessage,
} from './helpers'

const PUBLIC_API_BASE_URL = 'http://localhost:3001'

/**
 * This function starts the Administration API of one agent, with the versioning, the pipes and
 * the error envelope that the production server applies. The public module comes with it, so the
 * AnonCreds resources of the agent are readable.
 */
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
 * Two agents run the DIDComm protocols, and each caller drives its own steps through the accept
 * methods of the Administration API. Refer to [VSA-ADM-DC-PR] and [VSA-ADM-DC-CE].
 *
 * Faber takes the verifier and the issuer role. Alice takes the prover and the holder role. The
 * test asserts the state after every step, so it also shows that the agent stops at each step
 * that the specification gives to the caller, instead of completing the exchange itself.
 */

let JSON_SCHEMA_CREDENTIAL_ID: string

const CHAIN_ID = 'vna-test-1'
const CREDENTIAL_SCHEMA_ID = 7
const ECOSYSTEM_ID = 3
const CREDENTIAL_SCHEMA_REFERENCE = `vpr:verana:${CHAIN_ID}:cs:${CREDENTIAL_SCHEMA_ID}`

const veranaChain = { getChainId: CHAIN_ID } as unknown as VeranaChainService

let issuerParticipantIsActive = true

function fakeIndexer(ecosystemDid: string): VeranaIndexerService {
  const indexer = new VeranaIndexerService({
    baseUrl: 'http://indexer.test',
    logger: new TsLogger(LogLevel.Off, 'VeranaIndexer'),
  })

  vi.spyOn(indexer, 'getCredentialSchema').mockResolvedValue({
    id: CREDENTIAL_SCHEMA_ID,
    ecosystem_id: ECOSYSTEM_ID,
    json_schema: '{}',
    digest_algorithm: 'sha-384',
    archived: null,
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-01T00:00:00Z',
  })

  vi.spyOn(indexer, 'getEcosystem').mockResolvedValue({
    id: ECOSYSTEM_ID,
    did: ecosystemDid,
    corporation_id: 1,
    archived: null,
  })

  vi.spyOn(indexer, 'listParticipants').mockImplementation(async filter => {
    if (filter.did !== ecosystemDid || filter.schemaId !== CREDENTIAL_SCHEMA_ID || !filter.role) return []
    if (filter.role === ParticipantRole.Issuer && !issuerParticipantIsActive) return []
    return [
      {
        id: 1,
        did: ecosystemDid,
        role: filter.role,
        schema_id: CREDENTIAL_SCHEMA_ID,
        participant_state: ParticipantState.Active,
        revoked: null,
        slashed: null,
        modified: '2026-01-01T00:00:00Z',
      },
    ]
  })

  return indexer
}

async function publishVtjsc(agent: VsAgent<BaseAgentModules>, publicApiBaseUrl: string): Promise<string> {
  const credential = (await createJsc(
    agent,
    publicApiBaseUrl,
    {},
    { schemaBaseId: 'example-org', jsonSchemaRef: CREDENTIAL_SCHEMA_REFERENCE },
  )) as { id: string }

  mockResponses[credential.id] = credential
  return credential.id
}

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

describe('v2 didcomm accept routes, over two agents', () => {
  let faberAgent: VsAgent<BaseAgentModules>
  let aliceAgent: VsAgent<BaseAgentModules>
  let faberApp: INestApplication
  let aliceApp: INestApplication
  let credentialDefinitionId: string

  const resolver = new FakeDidResolver()

  const faber = () => request(faberApp.getHttpServer())
  const alice = () => request(aliceApp.getHttpServer())

  beforeAll(async () => {
    faberAgent = await startAgent({ label: 'Faber', domain: 'faber', veranaChain })
    faberAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(faberMessages))
    faberAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    faberAgent.dids.config.resolvers.unshift(resolver)
    await faberAgent.initialize()
    faberApp = await startAdminApi(faberAgent)

    aliceAgent = await startAgent({ label: 'Alice', domain: 'alice', veranaChain })
    aliceAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(aliceMessages))
    aliceAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    aliceAgent.dids.config.resolvers.unshift(resolver)
    await aliceAgent.initialize()
    aliceApp = await startAdminApi(aliceAgent)

    // Neither DID is published on a reachable host, so each agent resolves the other from memory.
    await resolver.registerAgent(faberAgent)
    await resolver.registerAgent(aliceAgent)

    JSON_SCHEMA_CREDENTIAL_ID = await publishVtjsc(faberAgent, 'https://faber')
    const ecosystemDid = faberAgent.did
    if (!ecosystemDid) throw new Error('Faber has no public DID')
    faberAgent.indexer = fakeIndexer(ecosystemDid)
    aliceAgent.indexer = fakeIndexer(ecosystemDid)

    // Alice resolves the AnonCreds resources of Faber from the test server of Faber, because
    // neither agent publishes on a reachable host.
    // The test replaces a private method of the registry, so the prototype needs a loose type.
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

    issueVtjscFrom(faberAgent.did)

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

  /** This function reads every record of one collection. */
  async function recordsOf(app: INestApplication, collection: Collection): Promise<Record<string, string>[]> {
    const response = await request(app.getHttpServer()).get(`/v2/didcomm/${collection}?limit=500`)
    return response.body.items ?? []
  }

  /** This function reads the identifiers that one collection holds now. */
  async function idsOf(app: INestApplication, collection: Collection): Promise<Set<string>> {
    const records = await recordsOf(app, collection)
    return new Set(records.map(record => record[idKey(collection)]))
  }

  /**
   * This function waits for a record that the given identifiers do not name yet. A peer creates
   * that record when its message arrives, so the caller cannot know the identifier in advance.
   */
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

  /** This function waits for one named record to reach the given state. */
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

  it('refuses a presentation request that the credential store cannot answer', async () => {
    const created = await faber()
      .post('/v2/didcomm/presentation-request')
      .send({ requestedCredentials: [{ credentialDefinitionId }] })
    expect(created.status).toBe(201)

    const known = await idsOf(aliceApp, 'presentations')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(invitationUrl(created.body.invitation), {
      label: 'Alice',
    })
    const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

    const accepted = await alice().post(`/v2/didcomm/presentations/${aliceProofId}/accept-request`)

    expect(accepted.status).toBe(409)
    expect(accepted.body.error.code).toBe('NO_COMPATIBLE_CREDENTIALS')
  }, 120_000)

  it('runs an issuance where each caller takes its own step', async () => {
    const offer = await faber().post('/v2/didcomm/credential-offer').send({ credentialDefinitionId, claims })
    expect(offer.status).toBe(201)
    const faberId = offer.body.credentialExchangeId

    const known = await idsOf(aliceApp, 'credential-exchanges')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(invitationUrl(offer.body.invitation), {
      label: 'Alice',
    })
    const aliceId = await untilNewRecord(aliceApp, 'credential-exchanges', 'offer-received', known)

    // Holder: the offer becomes a request.
    const acceptedOffer = await alice().post(`/v2/didcomm/credential-exchanges/${aliceId}/accept-offer`)
    expect(acceptedOffer.body.error ?? acceptedOffer.status).toBe(200)

    // The agent stops on `request-received`: the specification gives the issuing step to the caller.
    await untilRecordState(faberApp, 'credential-exchanges', faberId, 'request-received')

    // Issuer: the request becomes a credential.
    const acceptedRequest = await faber().post(`/v2/didcomm/credential-exchanges/${faberId}/accept-request`)
    expect(acceptedRequest.body.error ?? acceptedRequest.status).toBe(200)

    // The agent stops on `credential-received`: the holder stores the credential with a call.
    await untilRecordState(aliceApp, 'credential-exchanges', aliceId, 'credential-received')

    // Holder: the credential reaches the credential store.
    const acceptedCredential = await alice().post(
      `/v2/didcomm/credential-exchanges/${aliceId}/accept-credential`,
    )
    expect(acceptedCredential.body.error ?? acceptedCredential.status).toBe(200)
    expect(acceptedCredential.body.state).toBe('done')

    await untilRecordState(faberApp, 'credential-exchanges', faberId, 'done')
  }, 120_000)

  it('runs a presentation where each caller takes its own step', async () => {
    const created = await faber()
      .post('/v2/didcomm/presentation-request')
      .send({ requestedCredentials: [{ credentialDefinitionId, attributes: ['name', 'countryCode'] }] })
    expect(created.status).toBe(201)
    const faberProofId = created.body.proofExchangeId

    const known = await idsOf(aliceApp, 'presentations')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(invitationUrl(created.body.invitation), {
      label: 'Alice',
    })
    const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

    // Prover: the agent selects the credential of the store and presents it.
    const accepted = await alice().post(`/v2/didcomm/presentations/${aliceProofId}/accept-request`)
    expect(accepted.body.error ?? accepted.status).toBe(200)

    // The agent stops on `presentation-received`: the verifier acknowledges with a call.
    await untilRecordState(faberApp, 'presentations', faberProofId, 'presentation-received')

    // Verifier: the exchange completes.
    const acknowledged = await faber().post(`/v2/didcomm/presentations/${faberProofId}/accept-presentation`)
    expect(acknowledged.body.error ?? acknowledged.status).toBe(200)
    expect(acknowledged.body.state).toBe('done')
    expect(acknowledged.body.verified).toBe(true)
    expect(acknowledged.body.claims).toEqual(
      expect.arrayContaining([
        { name: 'name', value: 'OpenAI Research' },
        { name: 'countryCode', value: 'US' },
      ]),
    )
  }, 120_000)
  it('abandons a presentation whose issuer holds no active ISSUER Participant', async () => {
    const created = await faber()
      .post('/v2/didcomm/presentation-request')
      .send({ requestedCredentials: [{ credentialDefinitionId, attributes: ['name'] }] })
    expect(created.status).toBe(201)
    const faberProofId = created.body.proofExchangeId

    issuerParticipantIsActive = false

    try {
      const known = await idsOf(aliceApp, 'presentations')
      await aliceAgent.didcomm.oob.receiveInvitationFromUrl(invitationUrl(created.body.invitation), {
        label: 'Alice',
      })
      const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

      const accepted = await alice().post(`/v2/didcomm/presentations/${aliceProofId}/accept-request`)
      expect(accepted.body.error ?? accepted.status).toBe(200)

      await untilRecordState(faberApp, 'presentations', faberProofId, 'abandoned')

      const abandoned = await faber().get(`/v2/didcomm/presentations/${faberProofId}`)
      expect(abandoned.body.verified).toBe(false)
      expect(abandoned.body.errorMessage).toContain('e.p.issuer-not-authorized')

      const acknowledged = await faber().post(`/v2/didcomm/presentations/${faberProofId}/accept-presentation`)
      expect(acknowledged.status).toBe(409)
      expect(acknowledged.body.error.code).toBe('INVALID_STATE')
    } finally {
      issuerParticipantIsActive = true
    }
  }, 120_000)
  it('never acknowledges a presentation that fails the trust decision, whatever the autoAccept policy', async () => {
    const messageSender = faberAgent.dependencyManager.resolve(DidCommMessageSender)
    const sendMessage = vi.spyOn(messageSender, 'sendMessage')

    // no autoAcceptProof: the exchange takes the module default, which is ContentApproved
    const requested = await faberAgent.didcomm.proofs.createRequest({
      protocolVersion: 'v2',
      proofFormats: {
        anoncreds: {
          name: 'proof-request',
          version: '1.0',
          requested_attributes: {
            'gov-id': { names: ['name'], restrictions: [{ cred_def_id: credentialDefinitionId }] },
          },
        },
      },
    })
    requested.proofRecord.metadata.set(REQUESTED_CREDENTIAL_SCHEMAS_METADATA, [CREDENTIAL_SCHEMA_ID])
    await faberAgent.didcomm.proofs.update(requested.proofRecord)

    const faberProofId = requested.proofRecord.id
    const { invitation } = await createInvitation({ agent: faberAgent, messages: [requested.message] })

    issuerParticipantIsActive = false

    try {
      const known = await idsOf(aliceApp, 'presentations')
      await aliceAgent.didcomm.oob.receiveInvitationFromUrl(invitationUrl(invitation), {
        label: 'Alice',
      })
      const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

      const accepted = await alice().post(`/v2/didcomm/presentations/${aliceProofId}/accept-request`)
      expect(accepted.body.error ?? accepted.status).toBe(200)

      await untilRecordState(faberApp, 'presentations', faberProofId, 'abandoned')

      const sentTypes = sendMessage.mock.calls.map(call => call[0].message.type)
      expect(sentTypes).toContain(DidCommPresentationV2ProblemReportMessage.type.messageTypeUri)
      expect(sentTypes).not.toContain(DidCommPresentationV2AckMessage.type.messageTypeUri)

      const abandoned = await faber().get(`/v2/didcomm/presentations/${faberProofId}`)
      expect(abandoned.body.verified).toBe(false)
      expect(abandoned.body.errorMessage).toContain('e.p.issuer-not-authorized')

      const prover = await alice().get(`/v2/didcomm/presentations/${aliceProofId}`)
      expect(prover.body.state).not.toBe('done')
    } finally {
      issuerParticipantIsActive = true
      sendMessage.mockRestore()
    }
  }, 120_000)
  it('abandons a presentation whose exchange records no CredentialSchema of its request', async () => {
    const requested = await faberAgent.didcomm.proofs.createRequest({
      protocolVersion: 'v2',
      proofFormats: {
        anoncreds: {
          name: 'proof-request',
          version: '1.0',
          requested_attributes: {
            'gov-id': { names: ['name'], restrictions: [{ cred_def_id: credentialDefinitionId }] },
          },
        },
      },
    })
    const faberProofId = requested.proofRecord.id
    const { invitation } = await createInvitation({ agent: faberAgent, messages: [requested.message] })

    const known = await idsOf(aliceApp, 'presentations')
    await aliceAgent.didcomm.oob.receiveInvitationFromUrl(invitationUrl(invitation), {
      label: 'Alice',
    })
    const aliceProofId = await untilNewRecord(aliceApp, 'presentations', 'request-received', known)

    const accepted = await alice().post(`/v2/didcomm/presentations/${aliceProofId}/accept-request`)
    expect(accepted.body.error ?? accepted.status).toBe(200)

    await untilRecordState(faberApp, 'presentations', faberProofId, 'abandoned')

    const abandoned = await faber().get(`/v2/didcomm/presentations/${faberProofId}`)
    expect(abandoned.body.verified).toBe(false)
    expect(abandoned.body.errorMessage).toContain('e.p.trust-resolution-unavailable')
  }, 120_000)
})
