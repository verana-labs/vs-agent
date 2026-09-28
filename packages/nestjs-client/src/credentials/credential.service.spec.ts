import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { CredentialDefinition } from '@verana-labs/vs-agent-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VS_AGENT_CLIENT } from '../tokens'
import { CredentialStatus } from '../types'

import { CredentialEntity } from './credential.entity'
import { CredentialService } from './credential.service'
import { RevocationRegistryEntity } from './revocation-registry.entity'

const definition: CredentialDefinition = {
  id: 'def-id',
  name: 'TestCred',
  version: '1.0',
  attributes: ['name'],
  supportRevocation: true,
  relatedJsonSchemaCredentialId: 'jsc-id',
}

const registry = {
  id: 'reg-1',
  credentialDefinitionId: 'def-id',
  revocationDefinitionId: 'rev-def-id',
  currentIndex: 3,
  maximumCredentialNumber: 5,
} as RevocationRegistryEntity

const offer = { credentialExchangeId: 'cx-1', invitation: {}, shortUrl: 'https://short/1' }

describe('CredentialService', () => {
  let service: CredentialService
  let client: {
    anoncreds: Record<
      | 'listCredentialDefinitions'
      | 'createCredentialDefinition'
      | 'createRevocationRegistry'
      | 'revokeCredential',
      ReturnType<typeof vi.fn>
    >
    didcomm: { createCredentialOffer: ReturnType<typeof vi.fn> }
  }
  let credentialRepository: Record<'find' | 'findOne' | 'save', ReturnType<typeof vi.fn>> & {
    manager: { transaction: ReturnType<typeof vi.fn> }
  }
  let revocationRepository: { save: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    client = {
      anoncreds: {
        listCredentialDefinitions: vi.fn().mockResolvedValue({ items: [definition], nextCursor: null }),
        createCredentialDefinition: vi.fn().mockResolvedValue(definition),
        createRevocationRegistry: vi.fn().mockResolvedValue({ revocationRegistryDefinitionId: 'rev-def-id' }),
        revokeCredential: vi.fn().mockResolvedValue({}),
      },
      didcomm: { createCredentialOffer: vi.fn().mockResolvedValue(offer) },
    }
    credentialRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      save: vi.fn(async cred => cred),
      manager: { transaction: vi.fn() },
    }
    revocationRepository = { save: vi.fn(async entity => entity) }

    const module = await Test.createTestingModule({
      providers: [
        CredentialService,
        { provide: getRepositoryToken(CredentialEntity), useValue: credentialRepository },
        { provide: getRepositoryToken(RevocationRegistryEntity), useValue: revocationRepository },
        { provide: VS_AGENT_CLIENT, useValue: client },
      ],
    }).compile()
    service = module.get(CredentialService)
  })

  describe('createCredentialDefinition', () => {
    it('returns the existing definition for the schema', async () => {
      expect(await service.createCredentialDefinition('jsc-id')).toEqual(definition)
      expect(client.anoncreds.createCredentialDefinition).not.toHaveBeenCalled()
    })

    it('creates the definition and two registries when revocation is supported', async () => {
      client.anoncreds.listCredentialDefinitions.mockResolvedValue({ items: [], nextCursor: null })

      await service.createCredentialDefinition('jsc-id', {
        supportRevocation: true,
        maximumCredentialNumber: 5,
      })

      expect(client.anoncreds.createCredentialDefinition).toHaveBeenCalledWith({
        relatedJsonSchemaCredentialId: 'jsc-id',
        supportRevocation: true,
      })
      expect(client.anoncreds.createRevocationRegistry).toHaveBeenCalledTimes(2)
      expect(client.anoncreds.createRevocationRegistry).toHaveBeenCalledWith({
        credentialDefinitionId: 'def-id',
        maximumCredentialNumber: 5,
      })
      expect(revocationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ revocationDefinitionId: 'rev-def-id', currentIndex: 0 }),
      )
    })
  })

  describe('issue', () => {
    beforeEach(() => {
      credentialRepository.manager.transaction.mockResolvedValue({
        id: 'cred-1',
        connectionId: 'conn-1',
        revocationRegistryIndex: registry.currentIndex,
        revocationRegistry: { ...registry },
      })
    })

    it('offers the credential with the registry fields and stores the exchange id', async () => {
      const result = await service.issue({ name: 'John', age: 42 }, { connectionId: 'conn-1', refId: 'ref' })

      expect(result).toEqual(offer)
      expect(client.didcomm.createCredentialOffer).toHaveBeenCalledWith({
        credentialDefinitionId: 'def-id',
        claims: [
          { name: 'name', value: 'John' },
          { name: 'age', value: '42' },
        ],
        revocationRegistryDefinitionId: 'rev-def-id',
        revocationRegistryIndex: 3,
        autoAccept: true,
      })
      expect(credentialRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ credentialExchangeId: 'cx-1', status: CredentialStatus.OFFERED }),
      )
      expect(revocationRepository.save).toHaveBeenCalledWith(expect.objectContaining({ currentIndex: 4 }))
      expect(client.anoncreds.revokeCredential).not.toHaveBeenCalled()
    })

    it('creates the next registry when the current one reaches capacity', async () => {
      credentialRepository.manager.transaction.mockResolvedValue({
        id: 'cred-1',
        revocationRegistryIndex: 4,
        revocationRegistry: { ...registry, currentIndex: 4 },
      })

      await service.issue({ name: 'John' })

      expect(client.anoncreds.createRevocationRegistry).toHaveBeenCalledWith({
        credentialDefinitionId: 'def-id',
        maximumCredentialNumber: 5,
      })
    })

    it('revokes accepted credentials with the same refId when revokeIfAlreadyIssued is set', async () => {
      credentialRepository.find.mockResolvedValue([
        { id: 'old', credentialExchangeId: 'cx-0', revocationRegistryIndex: 1, revocationRegistry: registry },
      ])

      await service.issue({ name: 'John' }, { refId: 'ref', revokeIfAlreadyIssued: true })

      expect(credentialRepository.find).toHaveBeenCalledWith({
        where: { status: CredentialStatus.ACCEPTED, refIdHash: expect.any(String) },
        relations: ['revocationRegistry'],
      })
      expect(client.anoncreds.revokeCredential).toHaveBeenCalledWith({
        revocationRegistryDefinitionId: 'rev-def-id',
        revocationRegistryIndex: 1,
      })
      expect(credentialRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'old', status: CredentialStatus.REVOKED }),
      )
    })

    it('fails when no credential definition exists', async () => {
      client.anoncreds.listCredentialDefinitions.mockResolvedValue({ items: [], nextCursor: null })

      await expect(service.issue({ name: 'John' })).rejects.toThrow('No credential definitions found')
    })
  })

  describe('handleAcceptance and handleRejection', () => {
    it('marks the offered credential accepted', async () => {
      credentialRepository.findOne.mockResolvedValue({
        credentialExchangeId: 'cx-1',
        status: CredentialStatus.OFFERED,
      })

      await service.handleAcceptance('cx-1')

      expect(credentialRepository.findOne).toHaveBeenCalledWith({
        where: { credentialExchangeId: 'cx-1', status: CredentialStatus.OFFERED },
        order: { createdTs: 'DESC' },
      })
      expect(credentialRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.ACCEPTED }),
      )
    })

    it('marks the offered credential rejected', async () => {
      credentialRepository.findOne.mockResolvedValue({
        credentialExchangeId: 'cx-1',
        status: CredentialStatus.OFFERED,
      })

      await service.handleRejection('cx-1')

      expect(credentialRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.REJECTED }),
      )
    })

    it('fails when no offered credential matches', async () => {
      credentialRepository.findOne.mockResolvedValue(null)

      await expect(service.handleAcceptance('cx-9')).rejects.toThrow('cx-9')
    })
  })

  describe('revoke', () => {
    it('revokes through the registry by exchange id', async () => {
      credentialRepository.findOne.mockResolvedValue({
        id: 'cred-1',
        credentialExchangeId: 'cx-1',
        revocationRegistryIndex: 2,
        revocationRegistry: registry,
      })

      await service.revoke('conn-1', 'cx-1')

      expect(credentialRepository.findOne).toHaveBeenCalledWith({
        where: { credentialExchangeId: 'cx-1', status: CredentialStatus.ACCEPTED },
        relations: ['revocationRegistry'],
      })
      expect(client.anoncreds.revokeCredential).toHaveBeenCalledWith({
        revocationRegistryDefinitionId: 'rev-def-id',
        revocationRegistryIndex: 2,
      })
      expect(credentialRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.REVOKED }),
      )
    })

    it('marks a credential without a registry revoked locally only', async () => {
      credentialRepository.findOne.mockResolvedValue({ id: 'cred-1', credentialExchangeId: 'cx-1' })

      await service.revoke('conn-1')

      expect(client.anoncreds.revokeCredential).not.toHaveBeenCalled()
      expect(credentialRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CredentialStatus.REVOKED }),
      )
    })

    it('fails when no accepted credential matches', async () => {
      credentialRepository.findOne.mockResolvedValue(null)

      await expect(service.revoke('conn-1', 'cx-1')).rejects.toThrow(
        'Credential not found with credentialExchangeId "cx-1" or connectionId "conn-1".',
      )
    })
  })
})
