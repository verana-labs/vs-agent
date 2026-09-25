import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventHandler } from '../interfaces'
import { EVENT_HANDLER, EVENTS_MODULE_OPTIONS } from '../tokens'
import { ConnectionStatus } from '../types'

import { ConnectionEntity } from './connection.entity'
import { ConnectionsRepository } from './connection.repository'
import { ConnectionsService } from './connection.service'

async function build(
  connections: boolean | { requireProfile?: boolean },
  isCompleted: ReturnType<typeof vi.fn>,
): Promise<{ service: ConnectionsService; eventHandler: EventHandler }> {
  const eventHandler: EventHandler = { newConnection: vi.fn(), closeConnection: vi.fn(), onEvent: vi.fn() }
  const module = await Test.createTestingModule({
    providers: [
      ConnectionsService,
      { provide: EVENTS_MODULE_OPTIONS, useValue: { url: 'http://example.com', modules: { connections } } },
      { provide: EVENT_HANDLER, useValue: eventHandler },
      { provide: ConnectionsRepository, useValue: { isCompleted } },
    ],
  }).compile()
  return { service: module.get(ConnectionsService), eventHandler }
}

describe('ConnectionsService.handleNewConnection', () => {
  it('requires the profile by default and fires newConnection when the repository says completed', async () => {
    const isCompleted = vi.fn().mockResolvedValue(true)
    const { service, eventHandler } = await build(true, isCompleted)

    await service.handleNewConnection('conn-1')

    expect(isCompleted).toHaveBeenCalledWith('conn-1', true)
    expect(eventHandler.newConnection).toHaveBeenCalledWith('conn-1')
  })

  it('passes requireProfile false through and stays silent when not completed', async () => {
    const isCompleted = vi.fn().mockResolvedValue(false)
    const { service, eventHandler } = await build({ requireProfile: false }, isCompleted)

    await service.handleNewConnection('conn-1')

    expect(isCompleted).toHaveBeenCalledWith('conn-1', false)
    expect(eventHandler.newConnection).not.toHaveBeenCalled()
  })
})

describe('ConnectionsRepository.isCompleted', () => {
  let repository: ConnectionsRepository
  let findOne: ReturnType<typeof vi.fn>
  let update: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    findOne = vi.fn()
    update = vi.fn().mockResolvedValue({ affected: 1 })
    const module = await Test.createTestingModule({
      providers: [
        ConnectionsRepository,
        { provide: getRepositoryToken(ConnectionEntity), useValue: { findOne, update } },
      ],
    }).compile()
    repository = module.get(ConnectionsRepository)
  })

  it('completes without a profile when the profile is not required', async () => {
    findOne.mockResolvedValue({ id: 'conn-1', status: ConnectionStatus.Start })

    expect(await repository.isCompleted('conn-1', false)).toBe(true)
    expect(update).toHaveBeenCalledWith('conn-1', { status: ConnectionStatus.Completed })
  })

  it('waits for preferredLanguage when the profile is required', async () => {
    findOne.mockResolvedValue({
      id: 'conn-1',
      status: ConnectionStatus.Start,
      userProfile: { displayName: 'A' },
    })

    expect(await repository.isCompleted('conn-1', true)).toBe(false)
    expect(update).not.toHaveBeenCalled()

    findOne.mockResolvedValue({
      id: 'conn-1',
      status: ConnectionStatus.Start,
      userProfile: { preferredLanguage: 'en' },
    })

    expect(await repository.isCompleted('conn-1', true)).toBe(true)
  })

  it('never completes twice', async () => {
    findOne.mockResolvedValue({ id: 'conn-1', status: ConnectionStatus.Completed })

    expect(await repository.isCompleted('conn-1', false)).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})
