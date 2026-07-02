import { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { VtFlowState } from '@verana-labs/credo-ts-didcomm-vt-flow'
import {
  buildDefaultIndexerHandlerRegistry,
  IndexerWebSocketService,
  type IndexerActivity,
  type IndexerEventRecord,
  type VsAgent,
} from '@verana-labs/vs-agent-sdk'
import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startAgent } from './__mocks__'
import { FakeDidResolver } from './__mocks__/fakeDidResolver'
import {
  isIndexerNotificationEvent,
  isVtFlowStateChangedEvent,
  SubjectInboundTransport,
  SubjectOutboundTransport,
  waitForEvent,
  type SubjectMessage,
} from './helpers'

const PARTICIPANT_ID = 'participant-100'
const MSG = 'SetParticipantOPToValidated'

describe('verana: indexer notifications', () => {
  let applicant: VsAgent<any>
  let validator: VsAgent<any>
  let applicantConnection: DidCommConnectionRecord
  let validatorEvents: ReturnType<typeof vi.spyOn>
  const sharedResolver = new FakeDidResolver()

  const makeActivity = (): IndexerActivity => ({
    timestamp: '2024-01-01T00:00:00Z',
    block_height: 100,
    entity_type: 'Participant',
    entity_id: PARTICIPANT_ID,
    msg: MSG,
    changes: {},
  })

  const makeEvent = (): IndexerEventRecord => ({
    type: 'indexer-event',
    event_type: MSG,
    did: validator.did!,
    block_height: 100,
    tx_hash: 'TXHASH',
    timestamp: '2024-01-01T00:00:00Z',
    payload: {
      module: 'perm',
      action: 'validate',
      message_type: MSG,
      tx_index: 0,
      message_index: 0,
      sender: 'verana1operator',
      related_dids: [],
      entity_type: 'Participant',
      entity_id: PARTICIPANT_ID,
    },
  })

  const applyChanges = (service: IndexerWebSocketService) =>
    (service as any).applyChanges(makeEvent(), makeActivity()) as Promise<void>

  async function driveValidatorToValidating(): Promise<{ id: string }> {
    const validatorValidating = waitForEvent(
      validatorEvents,
      isVtFlowStateChangedEvent(VtFlowState.Validating),
    )

    await applicant.modules.vtFlow.sendOnboardingRequest({
      connectionId: applicantConnection.id,
      participantId: PARTICIPANT_ID,
      agentParticipantId: 'agent-participant-100',
      walletAgentParticipantId: 'wallet-agent-participant-100',
    })

    const validatingEvent = await validatorValidating
    const validatorRecord = await validator.modules.vtFlow.findById(validatingEvent.payload.vtFlowRecordId)
    return validatorRecord!
  }

  beforeEach(async () => {
    const applicantMessages = new Subject<SubjectMessage>()
    const validatorMessages = new Subject<SubjectMessage>()
    const subjectMap = {
      'rxjs:applicant': applicantMessages,
      'rxjs:validator': validatorMessages,
    }

    applicant = await startAgent({
      label: 'Applicant',
      domain: 'applicant',
      vtFlowOptions: {},
      didcommVersions: ['v1', 'v2'],
    })
    applicant.didcomm.registerInboundTransport(new SubjectInboundTransport(applicantMessages))
    applicant.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    applicant.dids.config.resolvers.unshift(sharedResolver)
    await applicant.initialize()
    await sharedResolver.registerAgent(applicant)

    validator = await startAgent({
      label: 'Validator',
      domain: 'validator',
      vtFlowOptions: {
        autoAcceptOnboardingRequest: true,
        autoMarkValidated: false,
        autoOfferCredential: false,
      },
      didcommVersions: ['v1', 'v2'],
    })
    validator.didcomm.registerInboundTransport(new SubjectInboundTransport(validatorMessages))
    validator.didcomm.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    validator.dids.config.resolvers.unshift(sharedResolver)
    await validator.initialize()
    await sharedResolver.registerAgent(validator)
    validatorEvents = vi.spyOn(validator.events, 'emit')

    const { connectionRecord } = await applicant.didcomm.oob.receiveImplicitInvitation({
      did: validator.did,
      label: applicant.label,
      didCommVersion: 'v2',
      ourDid: applicant.did,
    })
    if (!connectionRecord) throw new Error('Failed to establish DIDComm connection to validator')
    applicantConnection = await applicant.didcomm.connections.returnWhenIsConnected(connectionRecord.id)
  }, 30_000)

  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 200))
    await applicant?.shutdown()
    await validator?.shutdown()
    vi.restoreAllMocks()
  })

  it('emits an indexer-notification and runs the default handler for the activity', async () => {
    const record = await driveValidatorToValidating()
    const service = new IndexerWebSocketService({ indexerUrl: 'http://localhost:1', agent: validator })
    const notified = waitForEvent(validatorEvents, isIndexerNotificationEvent(MSG))
    const validated = waitForEvent(validatorEvents, isVtFlowStateChangedEvent(VtFlowState.Validated))

    await applyChanges(service)

    const notification = await notified
    expect(notification.payload.event).toMatchObject({
      msg: MSG,
      entityId: PARTICIPANT_ID,
      blockHeight: 100,
      txHash: 'TXHASH',
    })
    const validatedEvent = await validated
    expect(validatedEvent.payload.vtFlowRecordId).toBe(record.id)
  })

  it('still emits the indexer-notification when the default handler is overridden', async () => {
    const record = await driveValidatorToValidating()
    const customHandle = vi.fn().mockResolvedValue(undefined)
    const registry = buildDefaultIndexerHandlerRegistry()
    registry.register({ msg: MSG, handle: customHandle })
    const service = new IndexerWebSocketService({
      indexerUrl: 'http://localhost:1',
      agent: validator,
      handlerRegistry: registry,
    })
    const notified = waitForEvent(validatorEvents, isIndexerNotificationEvent(MSG))

    await applyChanges(service)

    await notified
    expect(customHandle).toHaveBeenCalledTimes(1)
    const updated = await validator.modules.vtFlow.findById(record.id)
    expect(updated?.state).toBe(VtFlowState.Validating)
  })
})
