import {
  AnonCredsCredentialDefinitionRepository,
  AnonCredsRevocationRegistryDefinitionPrivateRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchema,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { JsonObject, parseDid, TagsBase, utils, W3cCredential } from '@credo-ts/core'
import { Inject, Logger } from '@nestjs/common'
import { mapToEcosystem } from '@verana-labs/vs-agent-model'
import { deleteTailsEntry, fetchJson, VsAgent } from '@verana-labs/vs-agent-sdk'

import { VsAgentService } from '../../../services/VsAgentService'

type Tags = TagsBase & {
  type?: never
  attestedResourceId?: never
}

export class CredentialTypesService {
  private readonly logger = new Logger(CredentialTypesService.name)

  constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

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

    const [revRegAttested] = await agent.genericRecords.findAllByQuery({
      type: 'AttestedResource',
      attestedResourceId: revocationRegistryDefinitionId,
    })
    if (revRegAttested) {
      const links = (revRegAttested.content as { links?: Array<{ id: string; type: string }> })?.links
      if (Array.isArray(links)) {
        for (const link of links) {
          if (link?.type === 'anonCredsStatusList' && link.id) {
            const [statusListRecord] = await agent.genericRecords.findAllByQuery({
              type: 'AttestedResource',
              attestedResourceId: link.id,
            })
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
    if (tailsLocation) deleteTailsEntry(tailsLocation)

    if (revDefPrivate) await revocationDefinitionPrivateRepository.delete(agent.context, revDefPrivate)
    await revocationDefinitionRepository.delete(agent.context, revDef)
    return true
  }

  public async saveAttestedResource(agent: VsAgent, resource: Record<string, unknown>, tags?: Tags) {
    if (!resource) return
    return await agent.genericRecords.save({
      id: utils.uuid(),
      content: resource,
      tags: {
        attestedResourceId: resource.id as string,
        type: 'AttestedResource',
        ...tags,
      },
    })
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

    if (!issuerDid) {
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
    const response = await fetch(resourcesUrl)
    if (!response.ok) return undefined
    const [resource] = (await response.json()) as Array<{ id: string; content: AnonCredsSchema }>

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
    const foundSchema = await this.findAnonCredsSchema(options)

    if (foundSchema) {
      return {
        schemaId: foundSchema.schemaId,
        schema: foundSchema.schema,
      }
    } else {
      // No schema found. A new one will be created
      const parsedJsc = options.relatedJsonSchemaCredentialId
        ? await this.parseJsonSchemaCredential(options.relatedJsonSchemaCredentialId)
        : undefined
      const schemaAttributes = options.attributes ?? parsedJsc?.attrNames
      const schemaName = options.name ?? parsedJsc?.title
      const schemaVersion = options.version ?? '1.0'

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
            version: options.version ?? '1.0',
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

      await this.saveAttestedResource(agent, schemaRegistration, {
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

    await this.saveAttestedResource(agent, credentialRegistration, {
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

  public async parseJsonSchemaCredential(jsonSchemaCredentialId: string) {
    try {
      const jscData = await fetchJson<W3cCredential>(jsonSchemaCredentialId)
      const subjectId = this.getCredentialSubjectId(jscData.credentialSubject)
      const schemaData = await fetchJson<JsonObject>(mapToEcosystem(subjectId))
      const parsedSchema = schemaData as any
      const subjectProps = parsedSchema?.properties?.credentialSubject?.properties ?? {}

      const attrNames = Object.keys(subjectProps).map(String)
      if (attrNames.length === 0) {
        throw new Error(`No properties found in credentialSubject of schema from ${jsonSchemaCredentialId}`)
      }
      return { parsedSchema, attrNames, title: parsedSchema?.title as string | undefined }
    } catch (error) {
      throw new Error(`Failed to parse JSON Schema Credential ${jsonSchemaCredentialId}: ${error}`)
    }
  }
}
