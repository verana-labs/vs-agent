import type { OpenId4VcAgent } from '../src/types'
import type { DidTrustResolution, VsAgentModuleMessageReceivedEvent } from '@verana-labs/vs-agent-sdk'

import { TrustResolutionOutcome, VsAgentEventTypes } from '@verana-labs/vs-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenId4VcEventType } from '../src/events/openId4VcEvents'
import { toCredentialExchangeDto, toPresentationDto } from '../src/nestjs/mappers'

import {
  createTestAgentsInput,
  startTestAgents,
  TEST_ISSUER_DID,
  testCredentialConfiguration,
} from './helpers/startTestAgent'

type StateEvent = Record<string, unknown> & { state: string; previousState: string | null }

const TRUSTED: DidTrustResolution = {
  trusted: true,
  verified: true,
  outcome: TrustResolutionOutcome.VERIFIED,
  source: 'fresh',
}
const UNTRUSTED: DidTrustResolution = {
  trusted: false,
  verified: false,
  outcome: TrustResolutionOutcome.NOT_TRUSTED,
  source: 'fresh',
}

describe('OpenID4VC state events over the real flows', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>
  const resolveDidTrust = vi.fn<(did: string) => Promise<DidTrustResolution>>()

  beforeEach(async () => {
    resolveDidTrust.mockReset().mockResolvedValue(TRUSTED)
    agents = await startTestAgents({
      ...(await createTestAgentsInput()),
      resolveDidTrust: did => resolveDidTrust(did),
    })
  }, 60_000)

  afterEach(async () => {
    await agents?.stop()
  })

  async function issue() {
    const offer = await agents.issuer.service.createOffer({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      claims: { name: 'Ada Lovelace', role: 'engineer' },
      ttlSeconds: 3_600,
    })
    const session = await agents.issuer.agent.modules.openId4Vc?.issuer?.getIssuanceSessionById(
      offer.issuanceSessionId,
    )
    await agents.holder.acceptCredentialOffer(offer.credentialOffer)
    return { ...offer, preAuthorizedCode: session?.preAuthorizedCode }
  }

  async function present(requestedClaims: string[], queryLanguage?: 'dcql' | 'presentation_exchange') {
    const request = await agents.verifier.service.createRequest({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims,
      queryLanguage,
    })
    const resolved = await agents.holder.resolvePresentationRequest(request.authorizationRequest, [
      agents.rootCertificate,
    ])
    const submitted = await agents.holder.submitPresentation(resolved)
    expect(submitted.ok).toBe(true)
    return request.verificationSessionId
  }

  async function read(proofExchangeId: string) {
    const presentation = await agents.verifier.service.getVerificationSession(proofExchangeId)
    return asJson(toPresentationDto(presentation)) as Record<string, unknown>
  }

  it('announces every issuance transition as getCredentialExchange returns it, without the credential', async () => {
    const events = stateEvents(agents.issuer.agent, OpenId4VcEventType.CredentialExchangeStateUpdated)

    const offer = await issue()
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('Completed'))

    expect(events.map(event => [event.previousState, event.state])).toEqual([
      [null, 'OfferCreated'],
      ['OfferCreated', 'OfferUriRetrieved'],
      ['OfferUriRetrieved', 'AccessTokenRequested'],
      ['AccessTokenRequested', 'AccessTokenCreated'],
      ['AccessTokenCreated', 'CredentialRequestReceived'],
      ['CredentialRequestReceived', 'Completed'],
    ])
    for (const event of events) {
      expect(event).toMatchObject({
        credentialExchangeId: offer.issuanceSessionId,
        jsonSchemaCredentialId: testCredentialConfiguration.id,
      })
    }
    const { previousState: _previousState, ...record } = events[events.length - 1]
    expect(record).toEqual(
      asJson(
        toCredentialExchangeDto(await agents.issuer.service.getIssuanceSession(offer.issuanceSessionId)),
      ),
    )

    expect(offer.preAuthorizedCode).toEqual(expect.any(String))
    const serialized = JSON.stringify(events)
    for (const secret of [
      'Ada Lovelace',
      'engineer',
      offer.credentialOffer,
      String(offer.preAuthorizedCode),
    ]) {
      expect(serialized).not.toContain(secret)
    }
  }, 60_000)

  it.each([
    'dcql',
    'presentation_exchange',
  ] as const)('announces every %s verification transition, the verified one with the verdict getPresentation returns', async queryLanguage => {
    await issue()
    const events = stateEvents(agents.verifier.agent, OpenId4VcEventType.PresentationStateUpdated)

    const proofExchangeId = await present(['name'], queryLanguage)
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('ResponseVerified'))

    expect(events.map(event => [event.previousState, event.state])).toEqual([
      [null, 'RequestCreated'],
      ['RequestCreated', 'RequestUriRetrieved'],
      ['RequestUriRetrieved', 'ResponseVerified'],
    ])
    for (const event of events) {
      expect(event).toMatchObject({
        proofExchangeId,
        jsonSchemaCredentialId: testCredentialConfiguration.id,
        requestedClaims: ['name'],
      })
    }
    for (const event of events.slice(0, -1)) {
      expect(event).toMatchObject({ cryptographicVerified: false, accepted: false })
      expect(event).not.toHaveProperty('trust')
      expect(event).not.toHaveProperty('credential')
    }
    const { previousState: _previousState, ...record } = events[events.length - 1]
    expect(record).toMatchObject({
      cryptographicVerified: true,
      accepted: true,
      trust: { verdict: 'TRUSTED_AUTHORIZED', evidence: { did: TEST_ISSUER_DID, trustStatus: 'TRUSTED' } },
      credential: { vct: testCredentialConfiguration.vct, disclosedClaims: { name: 'Ada Lovelace' } },
    })
    expect(record).toEqual(await read(proofExchangeId))
    expect(resolveDidTrust).toHaveBeenCalledOnce()
  }, 60_000)

  it('announces the refusal of an issuer that the trust resolution does not trust', async () => {
    await issue()
    resolveDidTrust.mockResolvedValue(UNTRUSTED)
    const events = stateEvents(agents.verifier.agent, OpenId4VcEventType.PresentationStateUpdated)

    const proofExchangeId = await present(['name', 'role'])
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('ResponseVerified'))

    expect(events[events.length - 1]).toMatchObject({
      proofExchangeId,
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict: 'UNTRUSTED', evidence: { did: TEST_ISSUER_DID, trustStatus: 'UNTRUSTED' } },
      credential: { disclosedClaims: { name: 'Ada Lovelace', role: 'engineer' } },
    })
  }, 60_000)

  it('lets the wallet finish while the verdict is pending, and shares that decision with a read', async () => {
    await issue()
    let release: (() => void) | undefined
    resolveDidTrust.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve(TRUSTED)
        }),
    )
    const events = stateEvents(agents.verifier.agent, OpenId4VcEventType.PresentationStateUpdated)

    const proofExchangeId = await present(['name'])
    await vi.waitFor(() => expect(release).toBeDefined())
    expect(events.at(-1)?.state).toBe('RequestUriRetrieved')

    const reading = read(proofExchangeId)
    release?.()
    const presentation = await reading
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('ResponseVerified'))

    const { previousState: _previousState, updatedAt: _storedAt, ...record } = events[events.length - 1]
    const { updatedAt: _readAt, ...decided } = presentation
    expect(record).toEqual(decided)
    expect(decided).toMatchObject({ accepted: true, trust: { verdict: 'TRUSTED_AUTHORIZED' } })
    expect(resolveDidTrust).toHaveBeenCalledOnce()
  }, 60_000)

  it('announces RESOLVER_UNAVAILABLE without storing it, so the next read decides again', async () => {
    await issue()
    resolveDidTrust.mockRejectedValueOnce(new Error('the indexer is down'))
    const events = stateEvents(agents.verifier.agent, OpenId4VcEventType.PresentationStateUpdated)

    const proofExchangeId = await present(['name'])
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('ResponseVerified'))

    expect(events[events.length - 1]).toMatchObject({
      cryptographicVerified: true,
      accepted: false,
      trust: { verdict: 'RESOLVER_UNAVAILABLE' },
    })
    expect(await read(proofExchangeId)).toMatchObject({
      accepted: true,
      trust: { verdict: 'TRUSTED_AUTHORIZED' },
    })
    expect(resolveDidTrust).toHaveBeenCalledTimes(2)
  }, 60_000)
})

function stateEvents(agent: OpenId4VcAgent, type: OpenId4VcEventType): StateEvent[] {
  const events: StateEvent[] = []
  agent.events.on<VsAgentModuleMessageReceivedEvent>(
    VsAgentEventTypes.ModuleMessageReceived,
    ({ payload }) => {
      if (payload.type === type) events.push(asJson(payload.data) as StateEvent)
    },
  )
  return events
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}
