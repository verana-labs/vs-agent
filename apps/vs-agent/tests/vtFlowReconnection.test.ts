import {
  DidCommCredentialState,
  DidCommEventTypes,
  type DidCommMessageProcessedEvent,
} from '@credo-ts/didcomm'
import {
  VT_FLOW_ONBOARDING_REQUEST_TYPE,
  VT_FLOW_VALIDATING_TYPE,
  VtFlowRole,
  VtFlowState,
} from '@verana-labs/credo-ts-didcomm-vt-flow'
import {
  createW3cV2Credential,
  toOfferedCredentialJson,
  ValidationState,
  type VsAgent,
  VtFlowOrchestrator,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startAgent } from './__mocks__'
import { FakeDidResolver } from './__mocks__/fakeDidResolver'
import {
  isVtFlowStateChangedEvent,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  type SubjectMessage,
  waitForEvent,
} from './helpers'

const APPLICANT_PARTICIPANT = 5
const VALIDATOR_PARTICIPANT = 9

function isProcessedMessage(type: string) {
  return (event: unknown): event is DidCommMessageProcessedEvent => {
    const { type: eventType, payload } = (event ?? {}) as {
      type?: string
      payload?: { message?: { type?: string } }
    }
    return eventType === DidCommEventTypes.DidCommMessageProcessed && payload?.message?.type === type
  }
}

describe('vt-flow: applicant reconnection', () => {
  let applicant: VsAgent<any>
  let validator: VsAgent<any>
  let applicantEvents: ReturnType<typeof vi.spyOn>
  let validatorEvents: ReturnType<typeof vi.spyOn>
  let orchestrator: VtFlowOrchestrator
  let opState: ValidationState
  let subjectMap: Record<string, Subject<SubjectMessage>>
  const dids: { applicant?: string; validator?: string } = {}
  const sharedResolver = new FakeDidResolver()

  beforeEach(async () => {
    subjectMap = {
      'rxjs:applicant': new Subject<SubjectMessage>(),
      'rxjs:validator': new Subject<SubjectMessage>(),
    }
    opState = ValidationState.PENDING

    applicant = await startAgent({
      label: 'Applicant',
      domain: 'applicant',
      didcommVersions: ['v1', 'v2'],
      vtFlowOptions: { assertVerifiableService: async ({ peerDid }) => !peerDid.startsWith('did:peer:') },
      veranaChain: {} as never,
      indexer: {
        findParticipant: async (id: number) =>
          Number(id) === APPLICANT_PARTICIPANT
            ? {
                id: APPLICANT_PARTICIPANT,
                did: dids.applicant,
                role: 1,
                validatorParticipantId: VALIDATOR_PARTICIPANT,
                opState,
              }
            : { id: VALIDATOR_PARTICIPANT, did: dids.validator },
      } as never,
    })
    applicant.didcomm.registerInboundTransport(new SubjectInboundTransport(subjectMap['rxjs:applicant']))
    applicant.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    applicant.dids.config.resolvers.unshift(sharedResolver)
    await applicant.initialize()
    await sharedResolver.registerAgent(applicant)
    applicantEvents = vi.spyOn(applicant.events, 'emit')
    dids.applicant = applicant.did
    orchestrator = new VtFlowOrchestrator(applicant)
  }, 30_000)

  afterEach(async () => {
    await applicant?.shutdown()
    await validator?.shutdown()
    vi.restoreAllMocks()
  })

  async function startValidator(autoAcceptOnboardingRequest: boolean): Promise<void> {
    validator = await startAgent({
      label: 'Validator',
      domain: 'validator',
      didcommVersions: ['v1', 'v2'],
      vtFlowOptions: { autoAcceptOnboardingRequest, autoOfferCredential: false },
    })
    validator.didcomm.registerInboundTransport(new SubjectInboundTransport(subjectMap['rxjs:validator']))
    validator.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    validator.dids.config.resolvers.unshift(sharedResolver)
    await validator.initialize()
    await sharedResolver.registerAgent(validator)
    validatorEvents = vi.spyOn(validator.events, 'emit')
    dids.validator = validator.did
  }

  function onboardingRequestsProcessed(): number {
    return validatorEvents.mock.calls.flat().filter(isProcessedMessage(VT_FLOW_ONBOARDING_REQUEST_TYPE))
      .length
  }

  async function onboardUntilValidatorRotates() {
    await startValidator(true)
    const validating = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validating))
    const record = await orchestrator.startOnboardingProcess({
      applicantParticipantId: APPLICANT_PARTICIPANT,
    })
    const validatorRecordId = (await validating).payload.vtFlowRecordId

    await waitForEvent(applicantEvents, isProcessedMessage(VT_FLOW_VALIDATING_TYPE))

    const connection = await applicant.didcomm.connections.getById(record.connectionId)
    expect(connection.theirDid).toMatch(/^did:peer:/)
    expect(connection.previousTheirDids).toContain(validator.did)
    return { record, validatorRecordId, connection }
  }

  it('reconnects, resends the same request, and the flow goes on over the new connection', async () => {
    const { record, validatorRecordId, connection } = await onboardUntilValidatorRotates()
    await applicant.didcomm.connections.deleteById(connection.id)

    const before = onboardingRequestsProcessed()
    const resent = await orchestrator.startOnboardingProcess({
      applicantParticipantId: APPLICANT_PARTICIPANT,
    })
    await vi.waitFor(() => expect(onboardingRequestsProcessed()).toBe(before + 1))

    expect(resent.id).toBe(record.id)
    expect(resent.participantSessionId).toBe(record.participantSessionId)
    expect(resent.threadId).toBe(record.threadId)
    expect(resent.connectionId).not.toBe(connection.id)
    const validatorRecords = await validator.modules.vtFlow.findAllByQuery({ role: VtFlowRole.Validator })
    expect(validatorRecords).toHaveLength(1)
    expect(validatorRecords[0].id).toBe(validatorRecordId)
    expect(validatorRecords[0].threadId).toBe(record.threadId)
    expect(validatorRecords[0].state).toBe(VtFlowState.Validating)

    const oobPending = waitForEvent(applicantEvents, isVtFlowStateChangedEvent(VtFlowState.OobPending))
    await validator.modules.vtFlow.sendOobLink({
      vtFlowRecordId: validatorRecordId,
      url: 'https://collect.example/form',
      description: 'complete the form',
    })
    await oobPending
    const continued = await applicant.modules.vtFlow.getById(record.id)
    expect(continued.state).toBe(VtFlowState.OobPending)
    expect(continued.connectionId).toBe(resent.connectionId)
  }, 60_000)

  it('resends an undelivered request on the open connection and the validator re-attaches it', async () => {
    await startValidator(false)
    const awaitingOr = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.AwaitingOr))
    const record = await orchestrator.startOnboardingProcess({
      applicantParticipantId: APPLICANT_PARTICIPANT,
    })
    const validatorRecordId = (await awaitingOr).payload.vtFlowRecordId
    expect(record.state).toBe(VtFlowState.OrSent)
    await vi.waitFor(() => expect(onboardingRequestsProcessed()).toBe(1))

    const resent = await orchestrator.startOnboardingProcess({
      applicantParticipantId: APPLICANT_PARTICIPANT,
    })
    await vi.waitFor(() => expect(onboardingRequestsProcessed()).toBe(2))

    expect(resent.id).toBe(record.id)
    expect(resent.state).toBe(VtFlowState.OrSent)
    expect(resent.connectionId).toBe(record.connectionId)
    const validatorRecords = await validator.modules.vtFlow.findAllByQuery({ role: VtFlowRole.Validator })
    expect(validatorRecords).toHaveLength(1)
    expect(validatorRecords[0].id).toBe(validatorRecordId)
    expect(validatorRecords[0].threadId).toBe(record.threadId)
    expect(validatorRecords[0].state).toBe(VtFlowState.AwaitingOr)
  }, 60_000)

  it('reconnects during the credential offer and the flow is offered again on the new connection', async () => {
    const { record, validatorRecordId, connection } = await onboardUntilValidatorRotates()
    await validator.modules.vtFlow.markValidated(validatorRecordId)
    const credential = toOfferedCredentialJson(
      createW3cV2Credential({
        id: `${validator.did}#vtc-1`,
        type: ['VerifiableCredential', 'VerifiableTrustCredential'],
        issuer: validator.did!,
        credentialSubject: { id: applicant.did, name: 'Acme' },
      }),
    )
    const offer = () =>
      validator.modules.vtFlow.offerCredentialForSession({
        vtFlowRecordId: validatorRecordId,
        credentialFormats: { dataIntegrity: { credential, bindingRequired: false } },
      })

    const credOffered = waitForEvent(applicantEvents, isVtFlowStateChangedEvent(VtFlowState.CredOffered))
    const { credentialExchangeRecord: firstExchange } = await offer()
    await credOffered
    const offered = await applicant.modules.vtFlow.getById(record.id)
    expect(offered.subprotocolThid).toBe(firstExchange.threadId)
    await applicant.didcomm.credentials.acceptOffer({
      credentialExchangeRecordId: offered.credentialExchangeRecordId!,
      credentialFormats: { dataIntegrity: {} },
    })
    await vi.waitFor(async () =>
      expect((await validator.didcomm.credentials.getById(firstExchange.id)).state).toBe(
        DidCommCredentialState.RequestReceived,
      ),
    )
    await applicant.didcomm.connections.deleteById(connection.id)

    const before = onboardingRequestsProcessed()
    const resent = await orchestrator.startOnboardingProcess({
      applicantParticipantId: APPLICANT_PARTICIPANT,
    })
    await vi.waitFor(() => expect(onboardingRequestsProcessed()).toBe(before + 1))

    const validatorRecord = await validator.modules.vtFlow.getById(validatorRecordId)
    expect(validatorRecord.state).toBe(VtFlowState.Validated)
    expect(validatorRecord.credentialExchangeRecordId).toBeUndefined()
    expect(resent.id).toBe(record.id)
    expect(resent.state).toBe(VtFlowState.Validating)
    expect(resent.credentialExchangeRecordId).toBeUndefined()
    expect(resent.connectionId).not.toBe(connection.id)

    const { credentialExchangeRecord: secondExchange } = await offer()
    expect(secondExchange.id).not.toBe(firstExchange.id)
    await vi.waitFor(async () => {
      const reoffered = await applicant.modules.vtFlow.getById(record.id)
      expect(reoffered.state).toBe(VtFlowState.CredOffered)
      expect(reoffered.subprotocolThid).toBe(secondExchange.threadId)
      expect(reoffered.connectionId).toBe(resent.connectionId)
    })
  }, 60_000)
})
