import { createHash } from 'crypto'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ApiClient, CreateCredentialOfferResponse, CredentialDefinition } from '@verana-labs/vs-agent-client'
import { FindOneOptions, IsNull, Not, Repository } from 'typeorm'

import { VS_AGENT_CLIENT } from '../tokens'
import { CredentialStatus } from '../types'

import { CredentialEntity } from './credential.entity'
import { RevocationRegistryEntity } from './revocation-registry.entity'

export interface CreateCredentialDefinitionOptions {
  supportRevocation?: boolean
  maximumCredentialNumber?: number
}

export interface IssueOptions {
  connectionId?: string
  refId?: string
  credentialDefinitionId?: string
  jsonSchemaCredentialId?: string
  revokeIfAlreadyIssued?: boolean
}

@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name)

  constructor(
    @InjectRepository(CredentialEntity)
    private readonly credentialRepository: Repository<CredentialEntity>,
    @InjectRepository(RevocationRegistryEntity)
    private readonly revocationRepository: Repository<RevocationRegistryEntity>,
    @Inject(VS_AGENT_CLIENT) private readonly client: ApiClient,
  ) {}

  public async createCredentialDefinition(
    relatedJsonSchemaCredentialId: string,
    options: CreateCredentialDefinitionOptions = {},
  ): Promise<CredentialDefinition> {
    const { supportRevocation, maximumCredentialNumber } = options
    const definitions = await this.listCredentialDefinitions()
    const existing = definitions.find(
      definition => definition.relatedJsonSchemaCredentialId === relatedJsonSchemaCredentialId,
    )
    if (existing) return existing

    const definition = await this.client.anoncreds.createCredentialDefinition({
      relatedJsonSchemaCredentialId,
      supportRevocation,
    })
    if (supportRevocation) {
      await this.createRevocationRegistry(definition.id, maximumCredentialNumber)
      await this.createRevocationRegistry(definition.id, maximumCredentialNumber)
    }
    return definition
  }

  public async issue(
    claims: Record<string, unknown>,
    options: IssueOptions = {},
  ): Promise<CreateCredentialOfferResponse> {
    const { connectionId, revokeIfAlreadyIssued = false, jsonSchemaCredentialId } = options
    const refIdHash = options.refId ? this.hash(options.refId) : null

    const definitions = await this.listCredentialDefinitions()
    const definition =
      definitions.find(candidate =>
        options.credentialDefinitionId
          ? candidate.id === options.credentialDefinitionId
          : candidate.relatedJsonSchemaCredentialId === jsonSchemaCredentialId,
      ) ?? definitions[0]
    if (!definition) {
      throw new Error(
        'No credential definitions found. Please configure a credential using the create method before proceeding.',
      )
    }
    const { id: credentialDefinitionId, supportRevocation } = definition

    if (revokeIfAlreadyIssued) {
      const creds = await this.credentialRepository.find({
        where: { status: CredentialStatus.ACCEPTED, ...(refIdHash ? { refIdHash } : {}) },
        relations: ['revocationRegistry'],
      })
      for (const cred of creds) await this.revokeCredential(cred)
    }

    const cred: CredentialEntity = await this.credentialRepository.manager.transaction(async transaction => {
      if (!supportRevocation) {
        return await transaction.save(CredentialEntity, {
          connectionId,
          ...(refIdHash ? { refIdHash } : {}),
        })
      }

      let registry = await transaction
        .createQueryBuilder(RevocationRegistryEntity, 'registry')
        .where('registry.currentIndex != registry.maximumCredentialNumber')
        .andWhere('registry.credentialDefinitionId = :credentialDefinitionId', { credentialDefinitionId })
        .orderBy('registry.currentIndex', 'DESC')
        .setLock('pessimistic_write')
        .getOne()
      if (!registry) registry = await this.createRevocationRegistry(credentialDefinitionId)

      await transaction.save(RevocationRegistryEntity, registry)
      return await transaction.save(CredentialEntity, {
        connectionId,
        revocationRegistryIndex: registry.currentIndex,
        revocationRegistry: registry,
        ...(refIdHash ? { refIdHash } : {}),
      })
    })

    const offer = await this.client.didcomm.createCredentialOffer({
      credentialDefinitionId,
      claims: Object.entries(claims).map(([name, value]) => ({ name, value: String(value) })),
      revocationRegistryDefinitionId: cred.revocationRegistry?.revocationDefinitionId,
      revocationRegistryIndex: cred.revocationRegistryIndex,
      autoAccept: true,
    })
    cred.credentialExchangeId = offer.credentialExchangeId
    cred.status = CredentialStatus.OFFERED
    await this.credentialRepository.save(cred)

    if (cred.revocationRegistry) {
      cred.revocationRegistry.currentIndex += 1
      await this.revocationRepository.save(cred.revocationRegistry)

      if (cred.revocationRegistry.currentIndex === cred.revocationRegistry.maximumCredentialNumber) {
        const next = await this.createRevocationRegistry(
          credentialDefinitionId,
          cred.revocationRegistry.maximumCredentialNumber,
        )
        this.logger.log(`Revocation registry successfully created with ID ${next.revocationDefinitionId}`)
      }
    }
    return offer
  }

  public async handleAcceptance(credentialExchangeId: string): Promise<void> {
    const cred = await this.findOffered(credentialExchangeId)
    cred.status = CredentialStatus.ACCEPTED
    await this.credentialRepository.save(cred)
  }

  public async handleRejection(credentialExchangeId: string): Promise<void> {
    const cred = await this.findOffered(credentialExchangeId)
    cred.status = CredentialStatus.REJECTED
    await this.credentialRepository.save(cred)
  }

  public async revoke(connectionId: string, credentialExchangeId?: string): Promise<void> {
    const options: FindOneOptions<CredentialEntity> = credentialExchangeId
      ? {
          where: { credentialExchangeId, status: CredentialStatus.ACCEPTED },
          relations: ['revocationRegistry'],
        }
      : {
          where: { connectionId, status: CredentialStatus.ACCEPTED, credentialExchangeId: Not(IsNull()) },
          order: { createdTs: 'DESC' },
          relations: ['revocationRegistry'],
        }
    const cred = await this.credentialRepository.findOne(options)
    if (!cred) {
      throw new Error(
        `Credential not found with credentialExchangeId "${credentialExchangeId}" or connectionId "${connectionId}".`,
      )
    }
    await this.revokeCredential(cred)
  }

  private async revokeCredential(cred: CredentialEntity): Promise<void> {
    if (cred.revocationRegistry && cred.revocationRegistryIndex != null) {
      await this.client.anoncreds.revokeCredential({
        revocationRegistryDefinitionId: cred.revocationRegistry.revocationDefinitionId,
        revocationRegistryIndex: cred.revocationRegistryIndex,
      })
    } else {
      this.logger.warn(`Credential ${cred.id} has no revocation registry, marking it revoked locally only`)
    }
    cred.status = CredentialStatus.REVOKED
    await this.credentialRepository.save(cred)
    this.logger.log(`Credential revoked: ${cred.id}`)
  }

  private async findOffered(credentialExchangeId: string): Promise<CredentialEntity> {
    const cred = await this.credentialRepository.findOne({
      where: { credentialExchangeId, status: CredentialStatus.OFFERED },
      order: { createdTs: 'DESC' },
    })
    if (!cred) throw new Error(`Credential not found with credentialExchangeId: ${credentialExchangeId}`)
    return cred
  }

  private async listCredentialDefinitions(): Promise<CredentialDefinition[]> {
    const definitions: CredentialDefinition[] = []
    let cursor: string | undefined
    do {
      const page = await this.client.anoncreds.listCredentialDefinitions({ cursor })
      definitions.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return definitions
  }

  private async createRevocationRegistry(
    credentialDefinitionId: string,
    maximumCredentialNumber: number = 1000,
  ): Promise<RevocationRegistryEntity> {
    const { revocationRegistryDefinitionId } = await this.client.anoncreds.createRevocationRegistry({
      credentialDefinitionId,
      maximumCredentialNumber,
    })
    return await this.revocationRepository.save({
      credentialDefinitionId,
      revocationDefinitionId: revocationRegistryDefinitionId,
      currentIndex: 0,
      maximumCredentialNumber,
    })
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
