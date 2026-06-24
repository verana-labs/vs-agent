import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { DidCommConnectionRecord, DidCommHandshakeProtocol } from '@credo-ts/didcomm'
import { VtFlowRole, VtFlowState, VtFlowVariant } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { type VsAgent } from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startAgent } from './__mocks__'
import {
  FakeDidResolver,
  isVtFlowStateChangedEvent,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  waitForEvent,
  type SubjectMessage,
} from './helpers'

/**
 * Two-agent in-memory vt-flow round-trip covering thread-id correlation,
 * the Validator auto-chain up to VALIDATING/VALIDATED, and record metadata
 * on both sides. `autoOfferCredential` stays off so the test does not need
 * a signing-capable issuer DID; credential delivery is covered live.
 */
describe('vt-flow: two-agent integration', () => {
  let applicant: VsAgent<any>
  let validator: VsAgent<any>
  let applicantEvents: ReturnType<typeof vi.spyOn>
  let validatorEvents: ReturnType<typeof vi.spyOn>
  const sharedResolver = new FakeDidResolver()

  beforeEach(async () => {
    const applicantMessages = new Subject<SubjectMessage>()
    const validatorMessages = new Subject<SubjectMessage>()
    const subjectMap = {
      'rxjs:applicant': applicantMessages,
      'rxjs:validator': validatorMessages,
    }

    // Applicant only initiates OR/IR; no auto-chain flags needed.
    applicant = await startAgent({
      label: 'Applicant',
      domain: 'applicant',
      vtFlowOptions: {},
    })
    applicant.didcomm.registerInboundTransport(new SubjectInboundTransport(applicantMessages))
    applicant.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    applicant.dids.config.resolvers.unshift(sharedResolver)
    await applicant.initialize()
    await sharedResolver.registerAgent(applicant)
    applicantEvents = vi.spyOn(applicant.events, 'emit')

    validator = await startAgent({
      label: 'Validator',
      domain: 'validator',
      vtFlowOptions: {
        autoAcceptOnboardingRequest: true,
        autoAcceptIssuanceRequest: true,
        autoMarkValidated: true,
        autoOfferCredential: false,
      },
    })
    validator.didcomm.registerInboundTransport(new SubjectInboundTransport(validatorMessages))
    validator.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    validator.dids.config.resolvers.unshift(sharedResolver)
    await validator.initialize()
    await sharedResolver.registerAgent(validator)
    validatorEvents = vi.spyOn(validator.events, 'emit')
  }, 30_000)

  afterEach(async () => {
    applicantEvents.mockClear()
    await applicant?.shutdown()
    await validator?.shutdown()
    vi.restoreAllMocks()
  })

  it('issuance-request: Applicant IR_SENT, Validator auto-accepts to VALIDATING', async () => {
    const validatingReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validating))

    const applicantRecord = await applicant.modules.vtFlow.sendIssuanceRequest({
      recipientDid: validator.did,
      schemaId: 'https://example.test/schemas/organization.json',
      agentParticipantId: 'agent-participant-1',
      walletAgentParticipantId: 'wallet-agent-participant-1',
      claims: { name: 'Acme', country: 'CH' },
    })

    expect(applicantRecord.role).toBe(VtFlowRole.Applicant)
    expect(applicantRecord.variant).toBe(VtFlowVariant.DirectIssuance)
    expect(applicantRecord.state).toBe(VtFlowState.IrSent)
    expect(applicantRecord.schemaId).toBe('https://example.test/schemas/organization.json')
    expect(applicantRecord.claims).toEqual({ name: 'Acme', country: 'CH' })
    expect(applicantRecord.peerPublicDid).toBe(validator.did)
    expect(applicantRecord.connectionId).toBeDefined()

    const validatingEvent = await validatingReached
    const validatorRecord = await validator.modules.vtFlow.findById(validatingEvent.payload.vtFlowRecordId)
    expect(validatorRecord).not.toBeNull()
    expect(validatorRecord?.role).toBe(VtFlowRole.Validator)
    expect(validatorRecord?.variant).toBe(VtFlowVariant.DirectIssuance)
    expect(validatorRecord?.state).toBe(VtFlowState.Validating)
    expect(validatorRecord?.threadId).toBe(applicantRecord.threadId)
    expect(validatorRecord?.participantSessionId).toBe(applicantRecord.participantSessionId)
    expect(validatorRecord?.schemaId).toBe(applicantRecord.schemaId)
    expect(validatorRecord?.peerPublicDid).toBe(applicant.did)
  })

  it('onboarding-request: Applicant OR_SENT, Validator auto-accepts + auto-marks-validated', async () => {
    const validatedReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validated))

    const applicantRecord = await applicant.modules.vtFlow.sendOnboardingRequest({
      connectionId: applicantConnection.id,
      participantId: 'participant-42',
      agentParticipantId: 'agent-participant-2',
      walletAgentParticipantId: 'wallet-agent-participant-2',
      claims: { role: 'issuer' },
    })

    expect(applicantRecord.role).toBe(VtFlowRole.Applicant)
    expect(applicantRecord.variant).toBe(VtFlowVariant.OnboardingProcess)
    expect(applicantRecord.state).toBe(VtFlowState.OrSent)
    expect(applicantRecord.participantId).toBe('participant-42')

    const validatedEvent = await validatedReached
    const validatorRecord = await validator.modules.vtFlow.findById(validatedEvent.payload.vtFlowRecordId)
    expect(validatorRecord).not.toBeNull()
    expect(validatorRecord?.role).toBe(VtFlowRole.Validator)
    expect(validatorRecord?.variant).toBe(VtFlowVariant.OnboardingProcess)
    expect(validatorRecord?.state).toBe(VtFlowState.Validated)
    expect(validatorRecord?.threadId).toBe(applicantRecord.threadId)
    expect(validatorRecord?.participantId).toBe('participant-42')
  })

  it('onboarding-request: Applicant transitions OR_SENT -> VALIDATING on `validating`', async () => {
    const applicantEvents = vi.spyOn(applicant.events, 'emit')
    const applicantValidating = waitForEvent(
      applicantEvents,
      isVtFlowStateChangedEvent(VtFlowState.Validating),
    )
    const validatorValidated = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validated))

    const applicantRecord = await applicant.modules.vtFlow.sendOnboardingRequest({
      connectionId: applicantConnection.id,
      participantId: 'participant-77',
      agentParticipantId: 'agent-participant-77',
      walletAgentParticipantId: 'wallet-agent-participant-77',
    })
    expect(applicantRecord.state).toBe(VtFlowState.OrSent)

    const validatedEvent = await validatorValidated
    const validatorRecord = await validator.modules.vtFlow.findById(validatedEvent.payload.vtFlowRecordId)
    expect(validatorRecord).not.toBeNull()

    await validator.modules.vtFlow.sendValidating(validatorRecord!.id, {
      comment: 'Validating applicant documentation.',
    })

    await applicantValidating
    const updatedApplicant = await applicant.modules.vtFlow.findByThreadId(applicantRecord.threadId)
    expect(updatedApplicant?.state).toBe(VtFlowState.Validating)
  })

  it('threadId lookup on the Validator side matches the Applicant', async () => {
    const validatingReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validating))

    const applicantRecord = await applicant.modules.vtFlow.sendIssuanceRequest({
      recipientDid: validator.did,
      schemaId: 'https://example.test/schemas/service.json',
      agentParticipantId: 'agent-participant-3',
      walletAgentParticipantId: 'wallet-agent-participant-3',
    })
    await validatingReached

    const validatorRecord = await validator.modules.vtFlow.findByThreadId(applicantRecord.threadId)
    expect(validatorRecord).not.toBeNull()
    expect(validatorRecord?.id).toBeDefined()
    // Distinct records on each side, same thread.
    expect(validatorRecord?.id).not.toBe(applicantRecord.id)
  })

  it('sendValidating rotates the Validator DID from webvh to peer', async () => {
    const validatingReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validating))

    await applicant.modules.vtFlow.sendIssuanceRequest({
      recipientDid: validator.did,
      schemaId: 'https://example.test/schemas/rotation.json',
      agentPermId: 'agent-perm-4',
      walletAgentPermId: 'wallet-agent-perm-4',
    })

    const validatingEvent = await validatingReached
    const validatorRecord = await validator.modules.vtFlow.getById(validatingEvent.payload.vtFlowRecordId)
    const webvhDid = validator.did

    await validator.modules.vtFlow.sendValidating(validatorRecord.id)

    // Ensure the applicant has fully processed the validating message before afterEach closes the wallet.
    await waitForEvent(applicantEvents, (ev: unknown): ev is unknown => {
      const e = ev as any
      return e?.type === 'DidCommMessageProcessed' && String(e?.payload?.message?.type).includes('validating')
    })

    const conn = await validator.didcomm.connections.getById(validatorRecord.connectionId)
    expect(conn.did).not.toContain('did:webvh:')
    expect(conn.did).toContain('did:peer:')
    expect(conn.previousDids).toContain(webvhDid)
  })
})
