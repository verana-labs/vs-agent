import {
  DidCommConnectionEventTypes,
  DidCommOutOfBandEventTypes,
  DidCommOutOfBandRole,
} from '@credo-ts/didcomm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InvitationRecord, type InvitationRecordProps } from '../src/connections/InvitationRecord'
import { invitationEvents } from '../src/events/InvitationEvents'
import { VsAgentEventTypes } from '../src/events/VsAgentEvents'

const INVITATION_ID = 'oob-1'

const stored = new Map<string, InvitationRecordProps>()
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1))

const repository = {
  findById: vi.fn(async (_context: unknown, id: string) => {
    await tick()
    const props = stored.get(id)
    return props && new InvitationRecord({ ...props, acceptances: [...(props.acceptances ?? [])] })
  }),
  update: vi.fn(async (_context: unknown, record: InvitationRecord) => {
    await tick()
    stored.set(record.id, { ...record, acceptances: [...record.acceptances] })
  }),
}

const logger = { warn: vi.fn(), error: vi.fn() }
const on = vi.fn()
const emit = vi.fn()

const agent = {
  context: {},
  events: { on, emit },
  dependencyManager: { resolve: () => repository },
}

const handler = (type: string) => {
  const [, listener] = on.mock.calls.find(([registered]) => registered === type) as [
    string,
    (event: { payload: unknown }) => Promise<void>,
  ]
  return listener
}

const connection = (id: string, invitationId?: string) => ({
  id,
  theirDid: `did:peer:${id}`,
  getTag: (name: string) => (name === 'invitationId' ? invitationId : undefined),
})

const newConnection = (id: string) =>
  handler(DidCommConnectionEventTypes.DidCommConnectionStateChanged)({
    payload: { connectionRecord: connection(id, INVITATION_ID), previousState: null },
  })

const outOfBandRecord = (
  role = DidCommOutOfBandRole.Sender,
  tags: Record<string, unknown> = { invitationRecord: true },
) => ({
  id: INVITATION_ID,
  role,
  getTag: (name: string) => tags[name],
})

const reuse = (connectionId: string, record = outOfBandRecord()) =>
  handler(DidCommOutOfBandEventTypes.HandshakeReused)({
    payload: {
      reuseThreadId: `reuse-${connectionId}`,
      connectionRecord: connection(connectionId),
      outOfBandRecord: record,
    },
  })

const storeInvitation = (props: Partial<InvitationRecordProps> = {}) =>
  stored.set(INVITATION_ID, {
    id: INVITATION_ID,
    state: 'created',
    didcommVersion: 'v2',
    reusable: false,
    invitation: {},
    shortUrl: null,
    parentConnectionId: null,
    acceptances: [],
    ...props,
  })

const acceptances = () =>
  (stored.get(INVITATION_ID)?.acceptances ?? []).map(({ connectionId, reused }) => ({ connectionId, reused }))

const stateUpdates = () =>
  emit.mock.calls
    .filter(([, event]) => event.type === VsAgentEventTypes.InvitationStateUpdated)
    .map(([, { payload }]) => ({
      invitationRecordId: payload.event.invitationRecordId,
      state: payload.event.state,
      previousState: payload.event.previousState,
    }))

describe('invitation acceptances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored.clear()
    invitationEvents(agent as never, logger as never)
  })

  it('records a DID Exchange connection of a reusable invitation once, although it reports several states', async () => {
    storeInvitation({ reusable: true, didcommVersion: 'v1' })

    await newConnection('conn-1')
    await newConnection('conn-1')
    await newConnection('conn-1')

    expect(acceptances()).toEqual([{ connectionId: 'conn-1', reused: false }])
    expect(stateUpdates()).toHaveLength(1)
  })

  it('appends each acceptance of a reusable invitation, also a second one on the same connection', async () => {
    storeInvitation({ reusable: true })

    await newConnection('conn-1')
    await reuse('existing')
    await reuse('existing')

    expect(acceptances()).toEqual([
      { connectionId: 'conn-1', reused: false },
      { connectionId: 'existing', reused: true },
      { connectionId: 'existing', reused: true },
    ])
    expect(stateUpdates().map(({ previousState }) => previousState)).toEqual([
      'created',
      'accepted',
      'accepted',
    ])
  })

  it('logs and does not record a further acceptance of a single-use invitation', async () => {
    storeInvitation()
    await newConnection('conn-1')

    await newConnection('conn-2')
    await reuse('existing')

    expect(acceptances()).toEqual([{ connectionId: 'conn-1', reused: false }])
    expect(stateUpdates()).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`invitation ${INVITATION_ID} from did:peer:conn-2`),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`invitation ${INVITATION_ID} from did:peer:existing`),
    )
  })

  it('logs and does not record an acceptance of a deleted invitation record', async () => {
    await newConnection('conn-1')
    await reuse('existing')

    expect(repository.update).not.toHaveBeenCalled()
    expect(stateUpdates()).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`invitation ${INVITATION_ID} from did:peer:conn-1`),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`invitation ${INVITATION_ID} from did:peer:existing`),
    )
  })

  it('ignores connections and reuses of invitations that no invitation record wraps', async () => {
    await handler(DidCommConnectionEventTypes.DidCommConnectionStateChanged)({
      payload: { connectionRecord: connection('conn-1'), previousState: null },
    })
    await reuse('existing', outOfBandRecord(DidCommOutOfBandRole.Sender, {}))

    expect(repository.findById).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('keeps every acceptance of events that arrive together', async () => {
    storeInvitation({ reusable: true })

    await Promise.all([newConnection('conn-1'), reuse('existing'), newConnection('conn-2'), reuse('other')])

    expect(acceptances()).toEqual([
      { connectionId: 'conn-1', reused: false },
      { connectionId: 'existing', reused: true },
      { connectionId: 'conn-2', reused: false },
      { connectionId: 'other', reused: true },
    ])
    expect(stateUpdates().map(({ previousState }) => previousState)).toEqual([
      'created',
      'accepted',
      'accepted',
      'accepted',
    ])
  })
})
