import { Test } from '@nestjs/testing'
import { EventEnvelope } from '@verana-labs/vs-agent-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectionsRepository, ConnectionsService } from './connections'
import { CredentialService } from './credentials'
import { EventsService } from './events.service'
import { EventHandler } from './interfaces'
import { EVENT_HANDLER, EVENTS_MODULE_OPTIONS } from './tokens'
import { ConnectionStatus } from './types'

const timestamp = '2026-09-15T10:00:00.000Z'

function connectionEvent(
  id: string,
  state: 'completed' | 'abandoned',
  previousState: 'completed' | 'response-sent' | null = 'response-sent',
): EventEnvelope<'didcomm.connections.state-updated'> {
  return {
    id,
    type: 'didcomm.connections.state-updated',
    timestamp,
    data: {
      id: 'conn-1',
      state,
      previousState,
      role: 'responder',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

function profileEvent(
  id: string,
  preferredLanguage?: string,
): EventEnvelope<'didcomm.user-profile.profile-received'> {
  return {
    id,
    type: 'didcomm.user-profile.profile-received',
    timestamp,
    data: {
      connectionId: 'conn-1',
      profile: { displayName: 'Alice', preferredLanguage },
      sendBackYours: false,
    },
  }
}

function credentialEvent(
  id: string,
  state: 'done' | 'declined' | 'offer-sent',
  role: 'issuer' | 'holder' = 'issuer',
): EventEnvelope<'didcomm.credential-exchanges.state-updated'> {
  return {
    id,
    type: 'didcomm.credential-exchanges.state-updated',
    timestamp,
    data: {
      credentialExchangeId: 'cx-1',
      state,
      previousState: null,
      role,
      threadId: 'thread-1',
      claims: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

describe('EventsService', () => {
  let service: EventsService
  let eventHandler: EventHandler
  let repository: Record<keyof ConnectionsRepository, ReturnType<typeof vi.fn>>
  let credentials: { handleAcceptance: ReturnType<typeof vi.fn>; handleRejection: ReturnType<typeof vi.fn> }
  let rows: Map<string, { status: ConnectionStatus; userProfile?: { preferredLanguage?: string } }>

  beforeEach(async () => {
    rows = new Map()
    eventHandler = { newConnection: vi.fn(), closeConnection: vi.fn(), onEvent: vi.fn() }
    credentials = { handleAcceptance: vi.fn(), handleRejection: vi.fn() }
    repository = {
      create: vi.fn(async ({ id, status }) => {
        if (!rows.has(id)) rows.set(id, { status })
      }),
      findById: vi.fn(async id => rows.get(id)),
      updateStatus: vi.fn(async (id, status) => {
        const row = rows.get(id)
        if (row) row.status = status
        return row !== undefined
      }),
      updateUserProfile: vi.fn(async (id, userProfile) => {
        const row = rows.get(id)
        if (row) row.userProfile = userProfile
      }),
      isCompleted: vi.fn(async (id, requireProfile) => {
        const row = rows.get(id)
        if (!row || row.status === ConnectionStatus.Completed) return false
        const completed = !requireProfile || row.userProfile?.preferredLanguage != null
        if (completed) row.status = ConnectionStatus.Completed
        return completed
      }),
    }

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        ConnectionsService,
        {
          provide: EVENTS_MODULE_OPTIONS,
          useValue: { url: 'http://example.com', modules: { connections: true } },
        },
        { provide: EVENT_HANDLER, useValue: eventHandler },
        { provide: ConnectionsRepository, useValue: repository },
        { provide: CredentialService, useValue: credentials },
      ],
    }).compile()

    service = module.get(EventsService)
  })

  it('creates a row on completed and waits for the profile before newConnection', async () => {
    await service.receive(connectionEvent('e1', 'completed'))

    expect(repository.create).toHaveBeenCalledWith({
      id: 'conn-1',
      status: ConnectionStatus.Start,
      createdTs: new Date(timestamp),
    })
    expect(eventHandler.newConnection).not.toHaveBeenCalled()

    await service.receive(profileEvent('e2', 'en'))

    expect(repository.updateUserProfile).toHaveBeenCalledWith('conn-1', {
      displayName: 'Alice',
      preferredLanguage: 'en',
    })
    expect(eventHandler.newConnection).toHaveBeenCalledTimes(1)
    expect(eventHandler.newConnection).toHaveBeenCalledWith('conn-1')
  })

  it('fires newConnection once when the profile arrives before completed', async () => {
    await service.receive(profileEvent('e1', 'en'))
    expect(eventHandler.newConnection).toHaveBeenCalledTimes(1)

    await service.receive(connectionEvent('e2', 'completed'))
    expect(eventHandler.newConnection).toHaveBeenCalledTimes(1)
  })

  it('ignores a completed event whose previous state is already completed', async () => {
    await service.receive(connectionEvent('e1', 'completed', 'completed'))

    expect(repository.create).not.toHaveBeenCalled()
  })

  it('fires closeConnection on abandoned for a known connection only', async () => {
    await service.receive(connectionEvent('e1', 'abandoned'))
    expect(eventHandler.closeConnection).not.toHaveBeenCalled()

    rows.set('conn-1', { status: ConnectionStatus.Completed })
    await service.receive(connectionEvent('e2', 'abandoned'))

    expect(repository.updateStatus).toHaveBeenCalledWith('conn-1', ConnectionStatus.Terminated)
    expect(eventHandler.closeConnection).toHaveBeenCalledWith('conn-1')
  })

  it('routes issuer credential exchange states to the credential service', async () => {
    await service.receive(credentialEvent('e1', 'done'))
    await service.receive(credentialEvent('e2', 'declined'))
    await service.receive(credentialEvent('e3', 'offer-sent'))
    await service.receive(credentialEvent('e4', 'done', 'holder'))

    expect(credentials.handleAcceptance).toHaveBeenCalledTimes(1)
    expect(credentials.handleAcceptance).toHaveBeenCalledWith('cx-1')
    expect(credentials.handleRejection).toHaveBeenCalledTimes(1)
    expect(credentials.handleRejection).toHaveBeenCalledWith('cx-1')
  })

  it('drops a repeated envelope id', async () => {
    await service.receive(credentialEvent('e1', 'done'))
    await service.receive(credentialEvent('e1', 'done'))

    expect(credentials.handleAcceptance).toHaveBeenCalledTimes(1)
    expect(eventHandler.onEvent).toHaveBeenCalledTimes(1)
  })

  it('passes every envelope to onEvent, including unknown types and after an internal failure', async () => {
    credentials.handleAcceptance.mockRejectedValue(new Error('boom'))
    const unknown = { id: 'e2', type: 'didcomm.receipts.request-receipts-received', timestamp, data: {} }

    await service.receive(credentialEvent('e1', 'done'))
    await service.receive(unknown)

    expect(eventHandler.onEvent).toHaveBeenCalledTimes(2)
    expect(eventHandler.onEvent).toHaveBeenLastCalledWith(unknown)
  })

  it('propagates onEvent errors', async () => {
    vi.mocked(eventHandler.onEvent).mockRejectedValue(new Error('host failed'))

    await expect(service.receive(credentialEvent('e1', 'done'))).rejects.toThrow('host failed')
  })
})
