import {
  AnonCredsCredentialDefinitionRepository,
  AnonCredsRevocationRegistryDefinitionPrivateRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchema,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { JsonObject, parseDid, Proof, W3cCredential } from '@credo-ts/core'
import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import { HttpStatus, Inject, Logger } from '@nestjs/common'
import { mapToEcosystem } from '@verana-labs/vs-agent-model'
import {
  anonCredsSchemaFromJsonSchema,
  deleteTailsFile,
  fetchJson,
  findAttestedResource,
  saveAttestedResource,
  VsAgent,
} from '@verana-labs/vs-agent-sdk'

import { AdminApiError, AdminApiErrorCode } from '../../../common'
import { REVOCATION_REGISTRY_DEFAULT_CAPACITY } from '../../../config/constants'
import { VsAgentService } from '../../../services/VsAgentService'

const RESOLVE_TIMEOUT_MS = 30_000

export class CredentialTypesService {
  private readonly logger = new Logger(CredentialTypesService.name)

  constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

  public async listRevocationRegistries(agent: VsAgent, credentialDefinitionId?: string): Promise<string[]> {
    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )

    const revocationRegistries = credentialDefinitionId
      ? await revocationDefinitionRepository.findAllByCredentialDefinitionId(
          agent.context,
          credentialDefinitionId,
        )
      : await revocationDefinitionRepository.getAll(agent.context)

    return revocationRegistries.map(record => record.revocationRegistryDefinitionId)
  }

  public async createRevocationRegistry(
    agent: VsAgent,
    options: { credentialDefinitionId: string; maximumCredentialNumber?: number },
  ): Promise<string> {
    const { credentialDefinitionId } = options
    const maximumCredentialNumber = options.maximumCredentialNumber ?? REVOCATION_REGISTRY_DEFAULT_CAPACITY

    const cred = await agent.modules.anoncreds.getCredentialDefinition(credentialDefinitionId)

    if (!cred?.credentialDefinition) {
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        `no credential definition with id "${credentialDefinitionId}"`,
      )
    }

    if (!cred.credentialDefinition.value.revocation) {
      throw new AdminApiError(
        AdminApiErrorCode.InvalidState,
        HttpStatus.CONFLICT,
        `credential definition "${credentialDefinitionId}" does not support revocation`,
      )
    }

    const { revocationRegistryDefinitionState, registrationMetadata: revDefMetadata } =
      await agent.modules.anoncreds.registerRevocationRegistryDefinition({
        revocationRegistryDefinition: {
          credentialDefinitionId,
          tag: 'default',
          maximumCredentialNumber,
          issuerId: cred.credentialDefinition.issuerId,
        },
        options: {},
      })
    const { attestedResource: revocationRegistration } = revDefMetadata as {
      attestedResource: Record<string, unknown>
    }
    const revocationRegistryDefinitionId = revocationRegistryDefinitionState.revocationRegistryDefinitionId
    if (!revocationRegistryDefinitionId) {
      throw new Error(
        `Cannot create the revocation registry definition: ${failureReason(revocationRegistryDefinitionState)}`,
      )
    }
    this.logger.debug(
      `revocationRegistryDefinitionState: ${JSON.stringify(revocationRegistryDefinitionState)}`,
    )

    await saveAttestedResource(agent, revocationRegistration, {
      resourceType: 'anonCredsRevocRegDef',
    })

    // A registry without its first status list cannot issue, so a failure here undoes the
    // definition rather than leaving it behind for listRevocationRegistries to report.
    try {
      const { revocationStatusListState, registrationMetadata: revListMetadata } =
        await agent.modules.anoncreds.registerRevocationStatusList({
          revocationStatusList: {
            issuerId: cred.credentialDefinition.issuerId,
            revocationRegistryDefinitionId,
          },
          options: {},
        })
      const { attestedResource: statusRegistration } = revListMetadata as {
        attestedResource: Record<string, unknown>
      }
      if (!revocationStatusListState.revocationStatusList) {
        throw new Error(
          `Cannot create the revocation status list: ${failureReason(revocationStatusListState)}`,
        )
      }

      const revocationDefinitionRepository = agent.dependencyManager.resolve(
        AnonCredsRevocationRegistryDefinitionRepository,
      )
      const revocationDefinitionRecord =
        await revocationDefinitionRepository.getByRevocationRegistryDefinitionId(
          agent.context,
          revocationRegistryDefinitionId,
        )

      if (statusRegistration) {
        await this.appendStatusListToRevocationRegistry(
          agent,
          revocationRegistryDefinitionId,
          statusRegistration,
          revocationStatusListState.revocationStatusList.timestamp,
        )
      }

      revocationDefinitionRecord.metadata.set('revStatusList', revocationStatusListState.revocationStatusList)
      await revocationDefinitionRepository.update(agent.context, revocationDefinitionRecord)
    } catch (error) {
      await this.rollbackRevocationRegistry(agent, revocationRegistryDefinitionId)
      throw error
    }

    this.logger.log(`Revocation Registry Definition Id: ${revocationRegistryDefinitionId}`)

    return revocationRegistryDefinitionId
  }

  private async rollbackRevocationRegistry(agent: VsAgent, revocationRegistryDefinitionId: string) {
    try {
      await this.deleteRevocationRegistry(agent, revocationRegistryDefinitionId)
    } catch (error) {
      this.logger.error(
        `Cannot roll back the revocation registry definition ${revocationRegistryDefinitionId}: ${error}`,
      )
    }
  }

  public async deleteRevocationRegistry(
    agent: VsAgent,
    revocationRegistryDefinitionId: string,
  ): Promise<boolean> {
    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )
    const revocationDefinitionPrivateRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionPrivateRepository,
    )

    const revDef = await revocationDefinitionRepository.findByRevocationRegistryDefinitionId(
      agent.context,
      revocationRegistryDefinitionId,
    )
    if (!revDef) return false

    const revRegAttested = await findAttestedResource(agent, {
      attestedResourceId: revocationRegistryDefinitionId,
    })
    if (revRegAttested) {
      const links = (revRegAttested.content as { links?: Array<{ id: string; type: string }> })?.links
      if (Array.isArray(links)) {
        for (const link of links) {
          if (link?.type === 'anonCredsStatusList' && link.id) {
            const statusListRecord = await findAttestedResource(agent, { attestedResourceId: link.id })
            if (statusListRecord) await agent.genericRecords.delete(statusListRecord)
          }
        }
      }
      await agent.genericRecords.delete(revRegAttested)
    }

    const revDefPrivate = await revocationDefinitionPrivateRepository.findByRevocationRegistryDefinitionId(
      agent.context,
      revocationRegistryDefinitionId,
    )

    // Delete tails file and index entry if they exist
    const tailsLocation = revDef.revocationRegistryDefinition.value.tailsLocation
    if (tailsLocation) deleteTailsFile(agent.context, tailsLocation)

    if (revDefPrivate) await revocationDefinitionPrivateRepository.delete(agent.context, revDefPrivate)
    await revocationDefinitionRepository.delete(agent.context, revDef)
    return true
  }

  /**
   * Append a new status-list attestedResource to the rev-reg-def's links[] and persist
   * the status list. Looks up the rev-reg-def AttestedResource by id, throws if missing.
   * Used by both the credDef creation flow (first status list) and the revoke flow.
   */
  public async appendStatusListToRevocationRegistry(
    agent: VsAgent,
    revocationRegistryDefinitionId: string,
    statusRegistration: Record<string, unknown>,
    timestamp: number | undefined,
  ) {
    const revRegDefRecord = await findAttestedResource(agent, {
      attestedResourceId: revocationRegistryDefinitionId,
    })
    if (!revRegDefRecord) {
      throw new Error(`Revocation registry definition record not found for ${revocationRegistryDefinitionId}`)
    }

    const existingLinks = (revRegDefRecord.content as { links?: Array<Record<string, unknown>> }).links ?? []

    const registry = new WebVhAnonCredsRegistry()
    const { registrationMetadata } = await registry.updateRevocationRegistryDefinition(
      agent.context,
      revRegDefRecord.content as { proof?: Proof } & Record<string, object>,
      {
        links: [
          ...existingLinks,
          { id: statusRegistration.id as string, type: 'anonCredsStatusList', timestamp },
        ],
      },
    )

    await saveAttestedResource(agent, statusRegistration, { resourceType: 'anonCredsStatusList' })

    revRegDefRecord.content = registrationMetadata
    await agent.genericRecords.update(revRegDefRecord)
  }

  /**
   * Revoke a credential by its revocation registry index: update the AnonCreds status list and
   * publish the new status list entry so holders/verifiers resolve the revoked state. Shared by
   * the credential-revocation message handler and the VT revoke endpoint.
   */
  public async revokeCredential(
    agent: VsAgent,
    revocationRegistryDefinitionId: string,
    revocationRegistryIndex: number,
  ): Promise<{ timestamp: number }> {
    const uptStatusListResult = await agent.modules.anoncreds.updateRevocationStatusList({
      revocationStatusList: {
        revocationRegistryDefinitionId,
        revokedCredentialIndexes: [revocationRegistryIndex],
      },
      options: {},
    })

    const revocationStatusListState = uptStatusListResult.revocationStatusListState
    if (revocationStatusListState.state !== 'finished') {
      const detail =
        revocationStatusListState.state === 'failed'
          ? revocationStatusListState.reason
          : revocationStatusListState.state
      throw new Error(`Failed to update revocation status list: ${detail}`)
    }
    const revocationStatusList = revocationStatusListState.revocationStatusList

    const statusRegistration = (
      uptStatusListResult.registrationMetadata as { attestedResource?: Record<string, unknown> }
    )?.attestedResource
    if (!statusRegistration) {
      throw new Error('Revocation status list attestedResource missing from registration metadata')
    }

    await this.appendStatusListToRevocationRegistry(
      agent,
      revocationRegistryDefinitionId,
      statusRegistration,
      revocationStatusList.timestamp,
    )

    return { timestamp: revocationStatusList.timestamp }
  }

  public async findAnonCredsSchema(options: {
    schemaId?: string
    attributes?: string[]
    name?: string
    version?: string
    issuerDid?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    const agent = await this.agentService.getAgent()
    const { name, version, schemaId, issuerDid, relatedJsonSchemaCredentialId } = options

    if (schemaId) {
      const [schemaRecord] = await agent.modules.anoncreds.getCreatedSchemas({ schemaId })
      if (schemaRecord)
        return {
          schema: schemaRecord.schema,
          schemaId: schemaRecord.schemaId,
        }
    }

    if (!relatedJsonSchemaCredentialId && (!name || !version)) {
      throw new Error('Either relatedJsonSchemaCredentialId or "name" and "version" must be provided')
    }

    // the agent is the registry of its own objects, so it reads them from its records
    if (!issuerDid || issuerDid === agent.did) {
      const hasFilters = name != null || version != null || relatedJsonSchemaCredentialId != null

      if (!hasFilters) return undefined
      const [schemaRecord] = await agent.modules.anoncreds.getCreatedSchemas({
        name,
        version,
        relatedJsonSchemaCredentialId,
      })

      if (!schemaRecord) return undefined

      return {
        schema: schemaRecord.schema,
        schemaId: schemaRecord.schemaId,
      }
    }
    const parsedIssuerDid = parseDid(issuerDid)
    if (parsedIssuerDid.method !== 'webvh') {
      throw new Error(
        `Unsupported DID method '${parsedIssuerDid.method}'. When using 'relatedJsonSchemaCredentialId' with an external issuer, only 'webvh' DIDs are supported.`,
      )
    }
    const parsedIssuer = parsedIssuerDid.id.split(':').slice(1).join('/')

    const params = new URLSearchParams({ resourceType: 'anonCredsSchema' })
    if (options.relatedJsonSchemaCredentialId) {
      params.set('relatedJsonSchemaCredentialId', options.relatedJsonSchemaCredentialId)
    }

    const resourcesUrl = `https://${parsedIssuer}/resources?${params.toString()}`

    let resources: Array<{ id: string; content: AnonCredsSchema }> | undefined
    try {
      resources = await fetchJson<Array<{ id: string; content: AnonCredsSchema }>>(resourcesUrl, {
        timeoutMs: RESOLVE_TIMEOUT_MS,
        allowNotFound: true,
      })
    } catch (error) {
      throw new AdminApiError(
        AdminApiErrorCode.ResolverUnavailable,
        HttpStatus.SERVICE_UNAVAILABLE,
        `the AnonCreds registry at ${resourcesUrl} cannot be reached: ${error}`,
      )
    }

    const [resource] = resources ?? []
    if (!resource) return undefined

    return {
      schemaId: resource.id,
      schema: resource.content,
    }
  }

  public async findAnonCredsCredentialDefinition(options: {
    schemaId?: string
    name?: string
    version?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    const { name, version, schemaId, relatedJsonSchemaCredentialId } = options

    const agent = await this.agentService.getAgent()

    const [credentialDefinitionRecord] = await agent.modules.anoncreds.getCreatedCredentialDefinitions({
      schemaId,
      ...(name && version ? { tag: `${name}.${version}` } : {}),
      relatedJsonSchemaCredentialId,
    })
    if (credentialDefinitionRecord) return credentialDefinitionRecord
  }

  public async getOrRegisterAnonCredsSchema(options: {
    schemaId?: string
    attributes?: string[]
    name?: string
    version?: string
    issuerDid?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    if (options.schemaId) {
      const schemaRecord = await this.findAnonCredsSchema({ schemaId: options.schemaId })
      if (!schemaRecord) {
        throw new Error(`Schema not found for schemaId: ${options.schemaId}`)
      }
      return {
        schemaId: schemaRecord.schemaId,
        schema: schemaRecord.schema,
      }
    }

    if (options.attributes && options.relatedJsonSchemaCredentialId) {
      throw new Error('Cannot provide both "attributes" and "relatedJsonSchemaCredentialId" options')
    }

    if (!options.attributes && !options.relatedJsonSchemaCredentialId) {
      throw new Error('Either "attributes" or "relatedJsonSchemaCredentialId" option must be provided')
    }

    const agent = await this.agentService.getAgent()
    let schemaId: string | undefined
    let schema: AnonCredsSchema | undefined

    if (!agent.did) {
      throw new Error('Agent does not have any defined public DID')
    }

    const parsedJsc = options.relatedJsonSchemaCredentialId
      ? await this.parseJsonSchemaCredential(options.relatedJsonSchemaCredentialId)
      : undefined

    // an issuer of another DID builds on the schema of the VTJSC issuer and creates none of its
    // own: no request that names the VTJSC accepts a local schema, per [VSA-ADM-AC-CD-CREATE]
    if (options.relatedJsonSchemaCredentialId && parsedJsc && parsedJsc.issuer !== agent.did) {
      const resolved = await this.findAnonCredsSchema({
        relatedJsonSchemaCredentialId: options.relatedJsonSchemaCredentialId,
        issuerDid: parsedJsc.issuer,
      })
      if (!resolved) {
        throw new AdminApiError(
          AdminApiErrorCode.InvalidState,
          HttpStatus.CONFLICT,
          `the registry of "${parsedJsc.issuer}" lists no AnonCreds schema for "${options.relatedJsonSchemaCredentialId}" yet`,
        )
      }
      return { schemaId: resolved.schemaId, schema: resolved.schema }
    }

    const foundSchema = await this.findAnonCredsSchema(options)

    if (foundSchema) {
      return {
        schemaId: foundSchema.schemaId,
        schema: foundSchema.schema,
      }
    } else {
      // No schema found. A new one will be created
      const schemaAttributes = options.attributes ?? parsedJsc?.attrNames
      const schemaName = options.name ?? parsedJsc?.title
      const credentialSchemaId = parsedJsc?.subjectRef?.match(/:cs:(\d+)$/)?.[1]
      const schemaVersion = options.version ?? credentialSchemaId ?? '1.0'

      if (!schemaAttributes || !schemaName) {
        throw new Error('Schema must include both name and attributes (provided or derived from JSON Schema)')
      }

      const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)
      const equivalentSchemas = await schemaRepository.findByQuery(agent.context, {
        issuerId: agent.did,
        schemaName,
        schemaVersion,
      })
      if (equivalentSchemas.length > 0) {
        const [existing] = equivalentSchemas
        if (options.relatedJsonSchemaCredentialId && !existing.getTag('relatedJsonSchemaCredentialId')) {
          existing.setTag('relatedJsonSchemaCredentialId', options.relatedJsonSchemaCredentialId)
          await schemaRepository.update(agent.context, existing)
        }
        return { schemaId: existing.schemaId, schema: existing.schema }
      }

      const schemaRegistrationOptions = {
        extraMetadata: {
          relatedJsonSchemaCredentialId: options.relatedJsonSchemaCredentialId ?? null,
        },
      }
      const { schemaState, registrationMetadata: schemaMetadata } =
        await agent.modules.anoncreds.registerSchema({
          schema: {
            attrNames: schemaAttributes,
            name: schemaName,
            version: schemaVersion,
            issuerId: agent.did,
          },
          options: schemaRegistrationOptions,
        })

      const { attestedResource: schemaRegistration } = schemaMetadata as {
        attestedResource: Record<string, unknown>
      }
      schemaId = schemaState.schemaId
      schema = schemaState.schema

      if (!schemaId || !schema) {
        throw new Error('Schema for the credential definition could not be created')
      }
      const schemaRecord = (await schemaRepository.findBySchemaId(agent.context, schemaId)) ?? undefined
      if (!schemaRecord)
        throw new Error(`Schema record not found after registration for schemaId: ${schemaId}`)

      if (options.relatedJsonSchemaCredentialId) {
        schemaRecord.setTag('relatedJsonSchemaCredentialId', options.relatedJsonSchemaCredentialId)
      }

      await schemaRepository.update(agent.context, schemaRecord)

      await saveAttestedResource(agent, schemaRegistration, {
        resourceType: 'anonCredsSchema',
        relatedJsonSchemaCredentialId: options.relatedJsonSchemaCredentialId,
      })
    }
    return { schemaId, schema }
  }

  public async registerAnonCredsCredentialDefinition(options: {
    name: string
    schemaId: string
    supportRevocation?: boolean
    version?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    const {
      name,
      schemaId,
      supportRevocation = false,
      version = '1.0',
      relatedJsonSchemaCredentialId,
    } = options
    const agent = await this.agentService.getAgent()
    if (!agent.did) throw new Error('Agent does not have any defined public DID')

    const credentialDefinitionRegistrationOptions = {
      supportRevocation,
      extraMetadata: {
        relatedJsonSchemaCredentialId,
      },
    }

    // The registry resolves the schema via findBySchemaId, which throws if more than
    // one AnonCredsSchemaRecord matches. Collapse any duplicates before registering.
    const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)
    const duplicateSchemas = await schemaRepository.findByQuery(agent.context, { schemaId })
    if (duplicateSchemas.length > 1) {
      this.logger.warn(
        `Found ${duplicateSchemas.length} AnonCredsSchemaRecord entries for schemaId ${schemaId}; removing ${duplicateSchemas.length - 1} duplicate(s)`,
      )
      for (const extra of duplicateSchemas.slice(1)) await schemaRepository.delete(agent.context, extra)
    }

    const { credentialDefinitionState, registrationMetadata: credDefMetadata } =
      await agent.modules.anoncreds.registerCredentialDefinition({
        credentialDefinition: { issuerId: agent.did, schemaId, tag: `${name}.${version}` },
        options: credentialDefinitionRegistrationOptions,
      })
    const { attestedResource: credentialRegistration } = credDefMetadata as {
      attestedResource: Record<string, unknown>
    }

    const credentialDefinitionId = credentialDefinitionState.credentialDefinitionId

    if (!credentialDefinitionId) {
      throw new Error(`Cannot create credential definition: ${JSON.stringify(credentialDefinitionState)}`)
    }

    // Apply name and version as tags
    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )
    const credentialDefinitionRecord = await credentialDefinitionRepository.getByCredentialDefinitionId(
      agent.context,
      credentialDefinitionId,
    )
    credentialDefinitionRecord.setTag('name', name)
    credentialDefinitionRecord.setTag('version', version)
    if (relatedJsonSchemaCredentialId) {
      credentialDefinitionRecord.setTag('relatedJsonSchemaCredentialId', relatedJsonSchemaCredentialId)
    }

    await saveAttestedResource(agent, credentialRegistration, {
      resourceType: 'anonCredsCredDef',
      relatedJsonSchemaCredentialId,
    })
    await credentialDefinitionRepository.update(agent.context, credentialDefinitionRecord)

    return credentialDefinitionRecord
  }

  /**
   * Gets or registers an AnonCreds Credential Definition based on the provided parameters. If a
   * credential definition with the same schemaId, issuerId, name, version, and relatedJsonSchemaCredentialId
   * already exists, it will be returned. Otherwise, a new credential definition will be registered.
   *
   * @returns AnonCredCredentialDefinitionRecord of the existing or newly created credential definition
   */
  public async getOrRegisterAnonCredsCredentialDefinition({
    name,
    schemaId,
    supportRevocation = false,
    version = '1.0',
    attributes,
    relatedJsonSchemaCredentialId,
  }: {
    name?: string
    schemaId?: string
    attributes?: string[]
    supportRevocation?: boolean
    version?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    let credentialDefinitionRecord = await this.findAnonCredsCredentialDefinition({
      schemaId,
      name,
      version,
      relatedJsonSchemaCredentialId,
    })
    if (credentialDefinitionRecord) return credentialDefinitionRecord

    // Credential definition not found: create an appropriate schema for it
    const getOrRegisterSchemaResult = await this.getOrRegisterAnonCredsSchema({
      name,
      version,
      attributes,
      relatedJsonSchemaCredentialId,
    })
    const { schema, schemaId: resolvedSchemaId } = getOrRegisterSchemaResult
    credentialDefinitionRecord = await this.registerAnonCredsCredentialDefinition({
      name: schema.name,
      version: schema.version,
      schemaId: resolvedSchemaId,
      supportRevocation,
      relatedJsonSchemaCredentialId,
    })

    return credentialDefinitionRecord
  }

  private getCredentialSubjectId(credentialSubject: any): string {
    const subject = Array.isArray(credentialSubject) ? credentialSubject[0] : credentialSubject
    const id = subject?.id
    if (!id) {
      throw new Error('Missing credentialSubject.id in credential')
    }
    return id
  }

  public buildAnonCredsAttributes(
    attrNames: string[],
    providedAttributes: Array<{ name: string; value: string; mimeType?: string }>,
  ): Array<{ name: string; value: string; mimeType?: string }> {
    const providedNames = providedAttributes.map(a => a.name)
    const result = [...providedAttributes]
    for (const name of attrNames) {
      if (!providedNames.includes(name)) {
        result.push({ name, value: '' })
      }
    }
    return result
  }

  /** Answers `undefined` when the document is absent, and RESOLVER_UNAVAILABLE when it cannot be read. */
  private async resolveJson<T>(url: string): Promise<T | undefined> {
    try {
      return await fetchJson<T>(url, { timeoutMs: RESOLVE_TIMEOUT_MS, allowNotFound: true })
    } catch (error) {
      throw new AdminApiError(
        AdminApiErrorCode.ResolverUnavailable,
        HttpStatus.SERVICE_UNAVAILABLE,
        `${url} cannot be reached: ${error}`,
      )
    }
  }

  public async parseJsonSchemaCredential(jsonSchemaCredentialId: string) {
    try {
      const jscData = await this.resolveJson<W3cCredential>(jsonSchemaCredentialId)
      if (!jscData) throw new Error(`no document at ${jsonSchemaCredentialId}`)

      const subjectId = this.getCredentialSubjectId(jscData.credentialSubject)
      const schemaUrl = mapToEcosystem(subjectId)
      const schemaData = await this.resolveJson<JsonObject>(schemaUrl)
      if (!schemaData) throw new Error(`no JSON Schema at ${schemaUrl}`)

      const parsedSchema = schemaData as any
      const { name, attrNames } = anonCredsSchemaFromJsonSchema(parsedSchema)

      return {
        parsedSchema,
        attrNames,
        title: name,
        issuer: typeof jscData.issuer === 'string' ? jscData.issuer : jscData.issuer.id,
        subjectRef: subjectId,
      }
    } catch (error) {
      // an unreachable host is a state of the resolver, not an answer about the VTJSC
      if (error instanceof AdminApiError) throw error
      throw new AdminApiError(
        AdminApiErrorCode.UnknownId,
        HttpStatus.NOT_FOUND,
        `the agent cannot resolve relatedJsonSchemaCredentialId "${jsonSchemaCredentialId}": ${error}`,
      )
    }
  }
}

function failureReason(state: { state: string; reason?: string }): string {
  return state.state === 'failed' && state.reason ? state.reason : `the registry answered "${state.state}"`
}
