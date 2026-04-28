import type { VsAgent } from '@verana-labs/vs-agent-sdk'

import { DidCommConnectionRecord, DidCommHandshakeProtocol } from '@credo-ts/didcomm'
import { VtFlowRole, VtFlowState, VtFlowVariant } from '@verana-labs/credo-ts-didcomm-vt-flow'
import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isVtFlowStateChangedEvent,
  startAgent,
  SubjectInboundTransport,
  type SubjectMessage,
  SubjectOutboundTransport,
  waitForEvent,
} from './__mocks__'

/**
 * Two-agent in-memory vt-flow round-trip covering thread-id correlation,
 * the Validator auto-chain up to VALIDATING/VALIDATED, and record metadata
 * on both sides. `autoOfferCredential` stays off so the test does not need
 * a signing-capable issuer DID; credential delivery is covered live.
 */
describe('vt-flow: two-agent integration', () => {
  let applicant: VsAgent<any>
  let validator: VsAgent<any>
  let applicantConnection: DidCommConnectionRecord
  let validatorEvents: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    const applicantMessages = new Subject<SubjectMessage>()
    const validatorMessages = new Subject<SubjectMessage>()
    const subjectMap = {
      'rxjs:applicant': applicantMessages,
      'rxjs:validator': validatorMessages,
    }

    // Applicant only initiates VR/IR; no auto-chain flags needed.
    applicant = await startAgent({
      label: 'Applicant',
      domain: 'applicant',
      vtFlowOptions: {},
    })
    applicant.didcomm.registerInboundTransport(new SubjectInboundTransport(applicantMessages))
    applicant.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    await applicant.initialize()

    validator = await startAgent({
      label: 'Validator',
      domain: 'validator',
      vtFlowOptions: {
        autoAcceptValidationRequest: true,
        autoAcceptIssuanceRequest: true,
        autoMarkValidated: true,
        autoOfferCredential: false,
      },
    })
    validator.didcomm.registerInboundTransport(new SubjectInboundTransport(validatorMessages))
    validator.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    await validator.initialize()
    validatorEvents = vi.spyOn(validator.events, 'emit')
    ;[applicantConnection] = await makeConnection(applicant, validator)
  }, 30_000)

  afterEach(async () => {
    await applicant?.shutdown()
    await validator?.shutdown()
    vi.restoreAllMocks()
  })

  it('§5.2 issuance-request: Applicant IR_SENT, Validator auto-accepts to VALIDATING', async () => {
    const validatingReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validating))

    const applicantRecord = await applicant.modules.vtFlow.sendIssuanceRequest({
      connectionId: applicantConnection.id,
      schemaId: 'https://example.test/schemas/organization.json',
      agentPermId: 'agent-perm-1',
      walletAgentPermId: 'wallet-agent-perm-1',
      claims: { name: 'Acme', country: 'CH' },
    })

    expect(applicantRecord.role).toBe(VtFlowRole.Applicant)
    expect(applicantRecord.variant).toBe(VtFlowVariant.DirectIssuance)
    expect(applicantRecord.state).toBe(VtFlowState.IrSent)
    expect(applicantRecord.schemaId).toBe('https://example.test/schemas/organization.json')
    expect(applicantRecord.claims).toEqual({ name: 'Acme', country: 'CH' })

    const validatingEvent = await validatingReached
    const validatorRecord = await validator.modules.vtFlow.findById(validatingEvent.payload.vtFlowRecordId)
    expect(validatorRecord).not.toBeNull()
    expect(validatorRecord?.role).toBe(VtFlowRole.Validator)
    expect(validatorRecord?.variant).toBe(VtFlowVariant.DirectIssuance)
    expect(validatorRecord?.state).toBe(VtFlowState.Validating)
    expect(validatorRecord?.threadId).toBe(applicantRecord.threadId)
    expect(validatorRecord?.sessionUuid).toBe(applicantRecord.sessionUuid)
    expect(validatorRecord?.schemaId).toBe(applicantRecord.schemaId)
  })

  it('§5.1 validation-request: Applicant VR_SENT, Validator auto-accepts + auto-marks-validated', async () => {
    const validatedReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validated))

    const applicantRecord = await applicant.modules.vtFlow.sendValidationRequest({
      connectionId: applicantConnection.id,
      permId: 'perm-42',
      agentPermId: 'agent-perm-2',
      walletAgentPermId: 'wallet-agent-perm-2',
      claims: { role: 'issuer' },
    })

    expect(applicantRecord.role).toBe(VtFlowRole.Applicant)
    expect(applicantRecord.variant).toBe(VtFlowVariant.ValidationProcess)
    expect(applicantRecord.state).toBe(VtFlowState.VrSent)
    expect(applicantRecord.permId).toBe('perm-42')

    const validatedEvent = await validatedReached
    const validatorRecord = await validator.modules.vtFlow.findById(validatedEvent.payload.vtFlowRecordId)
    expect(validatorRecord).not.toBeNull()
    expect(validatorRecord?.role).toBe(VtFlowRole.Validator)
    expect(validatorRecord?.variant).toBe(VtFlowVariant.ValidationProcess)
    expect(validatorRecord?.state).toBe(VtFlowState.Validated)
    expect(validatorRecord?.threadId).toBe(applicantRecord.threadId)
    expect(validatorRecord?.permId).toBe('perm-42')
  })

  it('threadId lookup on the Validator side matches the Applicant', async () => {
    const validatingReached = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validating))

    const applicantRecord = await applicant.modules.vtFlow.sendIssuanceRequest({
      connectionId: applicantConnection.id,
      schemaId: 'https://example.test/schemas/service.json',
      agentPermId: 'agent-perm-3',
      walletAgentPermId: 'wallet-agent-perm-3',
    })
    await validatingReached

    const validatorRecord = await validator.modules.vtFlow.findByThreadId(applicantRecord.threadId)
    expect(validatorRecord).not.toBeNull()
    expect(validatorRecord?.id).toBeDefined()
    // Distinct records on each side, same thread.
    expect(validatorRecord?.id).not.toBe(applicantRecord.id)
  })
})

async function makeConnection(
  applicantAgent: VsAgent<any>,
  validatorAgent: VsAgent<any>,
): Promise<[DidCommConnectionRecord, DidCommConnectionRecord]> {
  const validatorOutOfBand = await validatorAgent.didcomm.oob.createInvitation({
    handshakeProtocols: [DidCommHandshakeProtocol.Connections],
  })

  const { connectionRecord: applicantConnection } = await applicantAgent.didcomm.oob.receiveInvitation(
    validatorOutOfBand.outOfBandInvitation,
    { label: applicantAgent.label },
  )

  const applicantCompleted = await applicantAgent.didcomm.connections.returnWhenIsConnected(
    applicantConnection!.id,
  )
  const [validatorRaw] = await validatorAgent.didcomm.connections.findAllByOutOfBandId(validatorOutOfBand.id)
  const validatorCompleted = await validatorAgent.didcomm.connections.returnWhenIsConnected(validatorRaw!.id)
  return [applicantCompleted, validatorCompleted]
}
