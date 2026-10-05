import type { OpenId4VcAgent } from '../src/types'
import type { VsAgentModuleMessageReceivedEvent } from '@verana-labs/vs-agent-sdk'

import { type BaseLogger, ConsoleLogger, LogLevel } from '@credo-ts/core'
import { OpenId4VcIssuerEvents, OpenId4VcVerifierEvents } from '@credo-ts/openid4vc'
import { VsAgentEventTypes } from '@verana-labs/vs-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenId4VcEventType } from '../src/events/openId4VcEvents'
import { toCredentialExchangeDto, toPresentationDto } from '../src/nestjs/mappers'
import { OpenId4VcPlugin } from '../src/nestjs/OpenId4VcPlugin'

import { createTestAgentsInput, startTestAgents, testCredentialConfiguration } from './helpers/startTestAgent'

type ModuleEvent = VsAgentModuleMessageReceivedEvent['payload']

describe('OpenID4VC state events over the real flows', () => {
  let agents: Awaited<ReturnType<typeof startTestAgents>>

  beforeEach(async () => {
    agents = await startTestAgents(await createTestAgentsInput())
  }, 60_000)

  afterEach(async () => {
    await agents?.stop()
  })

  it('emits one credential exchange event per issuance transition, shaped as getCredentialExchange', async () => {
    const events = moduleEventsOf(agents.issuer.agent)
    registerEvents(agents.issuer.agent)

    const offer = await agents.issuer.service.createOffer({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      claims: { name: 'Ada Lovelace', role: 'engineer' },
      ttlSeconds: 3_600,
    })
    await agents.holder.acceptCredentialOffer(offer.credentialOffer)

    expect(events.map(event => event.type)).toEqual(
      events.map(() => OpenId4VcEventType.CredentialExchangeStateUpdated),
    )
    expect(events.map(event => [event.data.previousState, event.data.state])).toEqual([
      [null, 'OfferCreated'],
      ['OfferCreated', 'OfferUriRetrieved'],
      ['OfferUriRetrieved', 'AccessTokenRequested'],
      ['AccessTokenRequested', 'AccessTokenCreated'],
      ['AccessTokenCreated', 'CredentialRequestReceived'],
      ['CredentialRequestReceived', 'Completed'],
    ])
    expect(events.every(event => event.data.credentialExchangeId === offer.issuanceSessionId)).toBe(true)

    const { previousState: _previousState, ...lastRecord } = events[events.length - 1].data
    const read = toCredentialExchangeDto(
      await agents.issuer.service.getIssuanceSession(offer.issuanceSessionId),
    )
    expect(asJson(lastRecord)).toEqual(asJson(read))

    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('Ada Lovelace')
    expect(serialized).not.toContain('engineer')
    expect(serialized).not.toContain(offer.credentialOffer)
  }, 60_000)

  it('emits one presentation event per verification transition up to the wallet reading the request', async () => {
    const events = moduleEventsOf(agents.verifier.agent)
    registerEvents(agents.verifier.agent)

    const request = await agents.verifier.service.createRequest({
      jsonSchemaCredentialId: testCredentialConfiguration.id,
      requestedClaims: ['name'],
    })
    await agents.holder.resolvePresentationRequest(request.authorizationRequest, [agents.rootCertificate])

    expect(events.map(event => event.type)).toEqual(
      events.map(() => OpenId4VcEventType.PresentationStateUpdated),
    )
    expect(events.map(event => [event.data.previousState, event.data.state])).toEqual([
      [null, 'RequestCreated'],
      ['RequestCreated', 'RequestUriRetrieved'],
    ])
    expect(events.every(event => event.data.proofExchangeId === request.verificationSessionId)).toBe(true)

    const { previousState: _previousState, ...lastRecord } = events[events.length - 1].data
    const read = toPresentationDto(
      await agents.verifier.service.getVerificationSession(request.verificationSessionId),
    )
    expect(asJson(lastRecord)).toEqual(asJson(read))
  }, 60_000)
})

describe('OpenID4VC state events', () => {
  it('carries the decision stored on a verified presentation, disclosed claims included', () => {
    const { agent, emitted, fire } = fakeAgent()
    registerEvents(agent)
    const decision = {
      cryptographicVerified: true,
      accepted: true,
      credential: { vct: testCredentialConfiguration.vct, disclosedClaims: { name: 'Ada Lovelace' } },
    }

    fire(OpenId4VcVerifierEvents.VerificationSessionStateChanged, {
      verificationSession: verificationSession({
        state: 'ResponseVerified',
        metadata: { 'openid4vc/verificationOutcome': decision },
      }),
      previousState: 'RequestUriRetrieved',
    })

    expect(emitted).toEqual([
      {
        type: OpenId4VcEventType.PresentationStateUpdated,
        data: expect.objectContaining({
          proofExchangeId: 'session-1',
          jsonSchemaCredentialId: testCredentialConfiguration.id,
          requestedClaims: ['name'],
          state: 'ResponseVerified',
          previousState: 'RequestUriRetrieved',
          ...decision,
        }),
      },
    ])
  })

  it('carries the error message of a session that fails', () => {
    const { agent, emitted, fire } = fakeAgent()
    registerEvents(agent)

    fire(OpenId4VcIssuerEvents.IssuanceSessionStateChanged, {
      issuanceSession: issuanceSession({ state: 'Error', errorMessage: 'invalid proof' }),
      previousState: 'CredentialRequestReceived',
    })

    expect(emitted).toEqual([
      {
        type: OpenId4VcEventType.CredentialExchangeStateUpdated,
        data: expect.objectContaining({
          credentialExchangeId: 'session-1',
          state: 'Error',
          errorMessage: 'invalid proof',
          previousState: 'CredentialRequestReceived',
        }),
      },
    ])
  })

  it('ignores the sessions of another issuer or verifier', () => {
    const { agent, emitted, fire } = fakeAgent()
    registerEvents(agent)

    fire(OpenId4VcIssuerEvents.IssuanceSessionStateChanged, {
      issuanceSession: issuanceSession({ issuerId: 'other-issuer' }),
      previousState: null,
    })
    fire(OpenId4VcVerifierEvents.VerificationSessionStateChanged, {
      verificationSession: verificationSession({ verifierId: 'other-verifier' }),
      previousState: null,
    })

    expect(emitted).toEqual([])
  })

  it('logs a record it cannot map instead of failing the state change that emitted it', () => {
    const { agent, emitted, fire } = fakeAgent()
    const logger = new ConsoleLogger(LogLevel.Off)
    const error = vi.spyOn(logger, 'error')
    registerEvents(agent, logger)
    const unreadable = () => {
      throw new Error('unreadable tag')
    }

    expect(() =>
      fire(OpenId4VcIssuerEvents.IssuanceSessionStateChanged, {
        issuanceSession: issuanceSession({ getTag: unreadable }),
        previousState: null,
      }),
    ).not.toThrow()
    expect(() =>
      fire(OpenId4VcVerifierEvents.VerificationSessionStateChanged, {
        verificationSession: verificationSession({ getTag: unreadable }),
        previousState: null,
      }),
    ).not.toThrow()

    expect(emitted).toEqual([])
    expect(error).toHaveBeenCalledTimes(2)
  })
})

function registerEvents(agent: OpenId4VcAgent, logger: BaseLogger = new ConsoleLogger(LogLevel.Off)): void {
  const plugin = OpenId4VcPlugin({ publicApiBaseUrl: 'https://agent.example', credentialConfigurations: [] })
  if (!plugin.registerEvents) throw new Error('the OpenID4VC plugin registers no events')
  plugin.registerEvents(agent as never, logger)
}

function moduleEventsOf(agent: OpenId4VcAgent): ModuleEvent[] {
  const events: ModuleEvent[] = []
  agent.events.on<VsAgentModuleMessageReceivedEvent>(
    VsAgentEventTypes.ModuleMessageReceived,
    ({ payload }) => {
      events.push(payload)
    },
  )
  return events
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function fakeAgent() {
  const handlers = new Map<string, (event: { payload: unknown }) => void>()
  const emitted: ModuleEvent[] = []
  const agent = {
    context: {},
    events: {
      on: (type: string, handler: (event: { payload: unknown }) => void) => handlers.set(type, handler),
      emit: (_context: unknown, event: { payload: ModuleEvent }) => emitted.push(event.payload),
    },
  }
  return {
    agent: agent as unknown as OpenId4VcAgent,
    emitted,
    fire: (type: string, payload: unknown) => handlers.get(type)?.({ payload }),
  }
}

function verificationSession({
  metadata = {},
  ...overrides
}: { metadata?: Record<string, unknown> } & Record<string, unknown> = {}) {
  const tags: Record<string, unknown> = {
    jsonSchemaCredentialId: testCredentialConfiguration.id,
    requestedClaims: ['name'],
  }
  return {
    id: 'session-1',
    verifierId: 'verifier',
    state: 'RequestCreated',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    getTag: (name: string) => tags[name],
    metadata: { get: (key: string) => metadata[key] ?? null },
    ...overrides,
  }
}

function issuanceSession(overrides: Record<string, unknown> = {}) {
  const tags: Record<string, unknown> = { jsonSchemaCredentialId: testCredentialConfiguration.id }
  return {
    id: 'session-1',
    issuerId: 'issuer',
    state: 'OfferCreated',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    getTag: (name: string) => tags[name],
    ...overrides,
  }
}
