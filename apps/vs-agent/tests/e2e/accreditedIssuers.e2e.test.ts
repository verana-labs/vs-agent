import '@openwallet-foundation/askar-nodejs'
// Registers the native anoncreds implementation the holder needs to answer offers/requests.
import '@hyperledger/anoncreds-nodejs'

import { ConsoleLogger, LogLevel } from '@credo-ts/core'
import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import { INestApplication } from '@nestjs/common'
import { Claim, CredentialIssuanceMessage, PresentationState } from '@verana-labs/vs-agent-model'
import {
  ParticipantRole,
  ParticipantState,
  VeranaChainService,
  VeranaIndexerService,
  VsAgentEventTypes,
  type BaseAgentModules,
  type VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  PARTICIPANT_ROLE_ISSUER,
  VeranaTestChain,
} from '../../../../packages/agent-sdk/tests/e2e/VeranaTestChain'
import {
  CHAIN_ID,
  COOLUSER_MNEMONIC,
  SETUP_TIMEOUT_MS,
  startStack,
  type StartedStack,
} from '../../../../packages/agent-sdk/tests/e2e/helpers'
import { MessageService, TrustService } from '../../src/controllers'
import {
  FakeDidResolver,
  isCredentialStateChangedEvent,
  startAgent,
  startServersTesting,
} from '../__mocks__'
import {
  makeConnection,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  waitForEvent,
  type SubjectMessage,
} from '../helpers'

const E2E_ENABLED = process.env.RUN_FLOW_E2E === '1'
const describeE2E = E2E_ENABLED ? describe : describe.skip

// Chain role ids for MsgStartParticipantOP. ISSUER/HOLDER are asserted by the existing e2e suites;
// the VERIFIER accreditation below is verified against the indexer before the flow runs.
const PARTICIPANT_ROLE_VERIFIER = 2

const RUN_ID = String(Date.now())
const ISSUER_DOMAIN = 'issuerverifier'
const HOLDER_DOMAIN = 'holder'

const JSC_URL = `https://${ISSUER_DOMAIN}/vt/schemas-badge-jsc.json`
const JSON_SCHEMA_URL = `https://${ISSUER_DOMAIN}/vt/cs/v1/js/badge`

const badgeJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ECS-Badge',
  description: 'multi-issuer badge',
  type: 'object',
  properties: {
    credentialSubject: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
}

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn().catch(() => undefined)
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 2_000))
  }
  throw new Error('condition did not resolve in time')
}

describeE2E('issuer-agnostic presentation verification against the Verana trust registry', () => {
  let stack: StartedStack
  let chain: VeranaTestChain
  let seeder: VeranaChainService
  let indexer: VeranaIndexerService
  let schemaId: number
  let issuerParticipantId: number
  let issuerCorporationAddress: string

  let issuerAgent: VsAgent<BaseAgentModules>
  let holderAgent: VsAgent<BaseAgentModules>
  let issuerApp: INestApplication
  let holderApp: INestApplication
  let issuerConnection: DidCommConnectionRecord
  let issuerEvents: ReturnType<typeof vi.spyOn>
  let holderEvents: ReturnType<typeof vi.spyOn>
  let jsonSchemaCredentialId: string
  let issuerDid: string

  const issuerMessages = new Subject<SubjectMessage>()
  const holderMessages = new Subject<SubjectMessage>()
  const subjectMap = {
    [`rxjs:${ISSUER_DOMAIN}`]: issuerMessages,
    [`rxjs:${HOLDER_DOMAIN}`]: holderMessages,
  }
  const logger = new ConsoleLogger(LogLevel.Warn)
  const sharedResolver = new FakeDidResolver()

  const claims = { name: `Badge Holder ${RUN_ID}` }

  beforeAll(async () => {
    stack = await startStack()
    chain = await VeranaTestChain.connect(stack.rpcUrl, COOLUSER_MNEMONIC)
    const indexerBaseUrl = stack.indexerWsUrl.replace(/^ws/, 'http')
    indexer = new VeranaIndexerService({ baseUrl: indexerBaseUrl, logger })

    const corpEco = await chain.createCorporation({ did: `did:example:eco-corp-${RUN_ID}` })
    await chain.fundCorporation(corpEco.policyAddress)
    await chain.grantOperatorAuthorization(corpEco.policyAddress)
    const eco = await chain.createEcosystem(corpEco.policyAddress, { did: `did:example:eco-${RUN_ID}` })
    const schema = await chain.createCredentialSchema(corpEco.policyAddress, {
      ecosystemId: eco.ecosystemId,
      jsonSchema: JSON.stringify(badgeJsonSchema),
    })
    schemaId = schema.schemaId
    const root = await chain.createRootParticipant(corpEco.policyAddress, {
      schemaId,
      did: `did:example:badge-root-${RUN_ID}`,
    })

    seeder = new VeranaChainService({
      rpcUrl: stack.rpcUrl,
      mnemonic: COOLUSER_MNEMONIC,
      corporationAddress: corpEco.policyAddress,
      logger,
    })
    await seeder.start()

    // A DID is controlled by a single corporation, so both accreditations of the agent live in the
    // same one. The overlap check keys on role too, so ISSUER and VERIFIER do not collide.
    const agentCorp = await chain.createCorporation({ did: `did:example:corp-agent-${RUN_ID}` })
    await chain.fundCorporation(agentCorp.policyAddress)
    await chain.grantOperatorAuthorization(agentCorp.policyAddress)

    const accredit = async (
      did: string,
      role: number,
      opSummaryDigest: string,
    ): Promise<{ participantId: number; policyAddress: string }> => {
      // No vsOperator: the validation below is signed by the ecosystem corporation, so the extra
      // funded operator and its authz grant would only cost two more block confirmations.
      const op = await chain.startParticipantOp(agentCorp.policyAddress, {
        role,
        validatorParticipantId: root.participantId,
        did,
      })
      // StartParticipantOP leaves effective_from unset; only the validation step activates it.
      await seeder.setParticipantOPToValidated({ id: op.participantId, opSummaryDigest })
      return { participantId: op.participantId, policyAddress: agentCorp.policyAddress }
    }

    issuerAgent = await startAgent({ label: 'Issuer', domain: ISSUER_DOMAIN, indexerBaseUrl })
    issuerAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(issuerMessages))
    issuerAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    issuerAgent.dids.config.resolvers.unshift(sharedResolver)
    await issuerAgent.initialize()
    await sharedResolver.registerAgent(issuerAgent)
    issuerApp = await startServersTesting(issuerAgent)

    holderAgent = await startAgent({ label: 'Holder', domain: HOLDER_DOMAIN, indexerBaseUrl })
    holderAgent.didcomm.registerInboundTransport(new SubjectInboundTransport(holderMessages))
    holderAgent.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    holderAgent.dids.config.resolvers.unshift(sharedResolver)
    await holderAgent.initialize()
    await sharedResolver.registerAgent(holderAgent)
    holderApp = await startServersTesting(holderAgent)
    ;[, issuerConnection] = await makeConnection(holderAgent, issuerAgent)

    issuerEvents = vi.spyOn(issuerAgent.events, 'emit')
    holderEvents = vi.spyOn(holderAgent.events, 'emit')

    // The agent DID only gets its webvh SCID on initialization, so it is accredited after startup.
    issuerDid = issuerAgent.did!

    const issuerAccreditation = await accredit(issuerDid, PARTICIPANT_ROLE_ISSUER, 'sha384-issuer')
    issuerParticipantId = issuerAccreditation.participantId
    issuerCorporationAddress = issuerAccreditation.policyAddress

    await accredit(issuerDid, PARTICIPANT_ROLE_VERIFIER, 'sha384-verifier')

    // Fail loudly here rather than let the flow silently exercise the wrong role.
    await until(async () => {
      const [issuers, verifiers] = await Promise.all([
        indexer.listParticipants({
          schemaId,
          role: ParticipantRole.Issuer,
          participantState: ParticipantState.Active,
        }),
        indexer.listParticipants({
          schemaId,
          role: ParticipantRole.Verifier,
          participantState: ParticipantState.Active,
        }),
      ])
      const isIssuer = issuers.some(participant => participant.did === issuerDid)
      const isVerifier = verifiers.some(participant => participant.did === issuerDid)
      return isIssuer && isVerifier ? true : undefined
    })

    // The JSC points at the on-chain credential schema, which is what ties the AnonCreds credential
    // to the trust registry entry the agents validate against.
    const jsonSchemaCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: JSC_URL,
      type: ['VerifiableCredential', 'JsonSchemaCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: JSON_SCHEMA_URL,
        type: 'JsonSchema',
        jsonSchema: { $ref: `vpr:verana:${CHAIN_ID}:cs:${schemaId}` },
      },
    }

    const fetchOriginal = global.fetch
    vi.stubGlobal('fetch', async (input: unknown, options?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input)
      const headers = new Headers()
      headers.set('content-type', 'application/ld+json')

      // The verifier looks the issuer's AnonCreds schema up over its public /resources endpoint.
      if (url.startsWith(`https://${ISSUER_DOMAIN}/resources`)) {
        const res = await request(issuerApp.getHttpServer()).get(url.slice(`https://${ISSUER_DOMAIN}`.length))
        return {
          ok: res.status === 200,
          headers,
          json: async () => res.body,
          text: async () => JSON.stringify(res.body),
        }
      }

      const body =
        url === JSC_URL ? jsonSchemaCredential : url === JSON_SCHEMA_URL ? badgeJsonSchema : undefined
      if (!body) return (fetchOriginal as (i: unknown, o?: RequestInit) => Promise<unknown>)(input, options)
      return { ok: true, headers, json: async () => body, text: async () => JSON.stringify(body) }
    })

    // The holder and the verifier resolve the issuer's AnonCreds resources over its public API.
    const resolveOriginal = WebVhAnonCredsRegistry.prototype['_resolveAndValidateAttestedResource']
    vi.spyOn(
      WebVhAnonCredsRegistry.prototype as any,
      '_resolveAndValidateAttestedResource',
    ).mockImplementation(async function (this: unknown, ...args: unknown[]) {
      const resourceId = String(args[1])
      if (resourceId.includes(`:${ISSUER_DOMAIN}/`)) {
        const cid = resourceId.split('/').pop()
        const res = await request(issuerApp.getHttpServer()).get(`/resources/${cid}`)
        if (res.status !== 200) throw new Error(`resource ${cid} not found in test server`)
        return { resolutionResult: { content: res.body }, resourceObject: res.body }
      }
      return (resolveOriginal as (...a: unknown[]) => unknown).call(this, ...args)
    })

    const trustService = issuerApp.get<TrustService>(TrustService, { strict: false })
    const messageService = issuerApp.get<MessageService>(MessageService, { strict: false })

    const issuance = await trustService.issueCredential({
      format: 'anoncreds',
      jsonSchemaCredentialId: JSC_URL,
      claims,
    })
    jsonSchemaCredentialId = issuance.jsonSchemaCredentialId!

    const holderCredential = waitForEvent(holderEvents, isCredentialStateChangedEvent)
    await messageService.sendMessage(
      {
        type: 'credential-issuance',
        connectionId: issuerConnection.id,
        claims: Object.entries(claims).map(([name, value]) => new Claim({ name, value: String(value) })),
        jsonSchemaCredentialId,
      } as CredentialIssuanceMessage,
      issuerConnection,
    )
    await holderCredential
    // ContentApproved only auto-accepts what answers a previous proposal, so the holder accepts the
    // offer explicitly, the same way a wallet would.
    const offered = await until(async () => {
      const [record] = await holderAgent.didcomm.credentials.findAllByQuery({ state: 'offer-received' })
      return record ?? undefined
    }, 60_000)
    await holderAgent.didcomm.credentials.acceptOffer({ credentialExchangeRecordId: offered.id })
    await until(async () => {
      const record = await holderAgent.didcomm.credentials.getById(offered.id)
      return record.state === 'done' ? true : undefined
    }, 60_000)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await issuerApp?.close()
    await holderApp?.close()
    await issuerAgent?.shutdown()
    await holderAgent?.shutdown()
    chain?.disconnect()
    await stack?.stop().catch(() => undefined)
  })

  // CONNECTED/SCANNED are emitted while the exchange is still in flight; only the terminal state
  // tells whether the presentation was accepted.
  const IN_FLIGHT_STATES: PresentationState[] = [PresentationState.CONNECTED, PresentationState.SCANNED]

  const isFinalStateFor =
    (proofExchangeId: string) =>
    (arg: unknown): arg is { payload: { event: { state: PresentationState } } } => {
      const event = (arg as { type?: string; payload?: { event?: Record<string, unknown> } })
      if (event?.type !== VsAgentEventTypes.PresentationStateUpdated) return false
      if (event.payload?.event?.proofExchangeId !== proofExchangeId) return false
      return !IN_FLIGHT_STATES.includes(event.payload.event.state as PresentationState)
    }

  const requestPresentation = async () => {
    const res = await request(issuerApp.getHttpServer())
      .post('/invitation/presentation-request')
      .send({
        callbackUrl: 'http://localhost:5000/message-received',
        requestedCredentials: [{ jsonSchemaCredentialId, attributes: ['name'] }],
      })
    if (res.status >= 400) throw new Error(`presentation-request failed: ${res.status} ${res.text}`)
    const { proofExchangeId, url } = res.body as { proofExchangeId: string; url: string }

    // The request travels inside an out-of-band invitation, so the holder has to receive it for the
    // exchange to start; auto-accept then drives the presentation back to the verifier.
    await holderAgent.didcomm.oob.receiveInvitationFromUrl(url, { label: holderAgent.label })

    // Same as above: the holder drives the presentation explicitly.
    const requested = await until(async () => {
      const [record] = await holderAgent.didcomm.proofs.findAllByQuery({ state: 'request-received' })
      return record ?? undefined
    }, 60_000)
    await holderAgent.didcomm.proofs.acceptRequest({ proofExchangeRecordId: requested.id })

    // waitForEvent polls forever, so cap it to fail fast instead of hanging the suite.
    return Promise.race([
      waitForEvent(issuerEvents, isFinalStateFor(proofExchangeId)),
      new Promise<never>((_, reject) =>
        setTimeout(async () => {
          const holderProofs = await holderAgent.didcomm.proofs.getAll()
          const issuerProofs = await issuerAgent.didcomm.proofs.getAll()
          const holderCredentials = await holderAgent.didcomm.credentials.getAll()
          reject(
            new Error(
              `no final state for proof ${proofExchangeId}. ` +
                `holder proofs=${JSON.stringify(holderProofs.map(r => [r.state, r.errorMessage]))} ` +
                `issuer proofs=${JSON.stringify(issuerProofs.map(r => [r.state, r.errorMessage]))} ` +
                `holder credentials=${JSON.stringify(holderCredentials.map(r => r.state))}`,
            ),
          )
        }, 60_000),
      ),
    ])
  }

  it(
    'accepts a presentation whose issuer is an active accredited issuer of the schema',
    async () => {
      const event = await requestPresentation()
      expect(event.payload.event.state).toBe(PresentationState.OK)
    },
    SETUP_TIMEOUT_MS,
  )

  it(
    'rejects the same credential once the issuer accreditation is revoked on chain',
    async () => {
      await chain.revokeParticipant(issuerCorporationAddress, issuerParticipantId)

      await until(async () => {
        const issuers = await indexer.listParticipants({
          schemaId,
          role: ParticipantRole.Issuer,
          participantState: ParticipantState.Active,
        })
        return issuers.some(participant => participant.did === issuerDid) ? undefined : true
      })

      const event = await requestPresentation()
      expect(event.payload.event.state).toBe(PresentationState.UNTRUSTED_ISSUER)
    },
    SETUP_TIMEOUT_MS,
  )
})
