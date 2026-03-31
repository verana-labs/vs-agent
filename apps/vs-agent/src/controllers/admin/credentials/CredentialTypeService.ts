import {
  AnonCredsCredentialDefinitionRepository,
  AnonCredsSchema,
  AnonCredsSchemaRecord,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { JsonObject, parseDid, TagsBase, utils, W3cCredential } from '@credo-ts/core'
import { Inject, Logger } from '@nestjs/common'
import { mapToEcosystem } from '@verana-labs/vs-agent-model'

import { VsAgentService } from '../../../services/VsAgentService'
import { fetchJson, VsAgent } from '../../../utils'

type Tags = TagsBase & {
  type?: never
  attestedResourceId?: never
}

export class CredentialTypesService {
  private readonly logger = new Logger(CredentialTypesService.name)

  constructor(@Inject(VsAgentService) private readonly agentService: VsAgentService) {}

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
    issuerId?: string
    relatedJsonSchemaCredentialId?: string
  }): Promise<AnonCredsSchemaRecord | undefined> {
    const agent = await this.agentService.getAgent()

    if (options.schemaId) {
      const [schemaRecord] = await agent.modules.anoncreds.getCreatedSchemas({ schemaId: options.schemaId })
      if (schemaRecord) return schemaRecord
    }

    if (!options.relatedJsonSchemaCredentialId && (!options.name || !options.version)) {
      throw new Error('Either relatedJsonSchemaCredentialId or "name" and "version" must be provided')
    }

    if (!options.issuerId) {
      const [schemaRecord] = await agent.modules.anoncreds.getCreatedSchemas({
        relatedJsonSchemaCredentialId: options.relatedJsonSchemaCredentialId,
      })
      return schemaRecord ?? undefined
    }

    const parsedIssuerDid = parseDid(options.issuerId)
    const parsedIssuer =
      parsedIssuerDid.method === 'webvh'
        ? parsedIssuerDid.id.split(':').slice(1).join('/')
        : parsedIssuerDid.id.replace(/:/g, '/')

    const params = new URLSearchParams({ resourceType: 'anonCredsSchema' })
    if (options.relatedJsonSchemaCredentialId) {
      params.set('relatedJsonSchemaCredentialId', options.relatedJsonSchemaCredentialId)
    }

    const resourcesUrl = `https://${parsedIssuer}/resources?${params.toString()}`
    const [resource] = await fetchJson<Array<{ id: string; content: AnonCredsSchema }>>(resourcesUrl)
    if (!resource) return undefined

    return new AnonCredsSchemaRecord({
      schemaId: resource.id,
      schema: resource.content,
      methodName: parsedIssuerDid.method,
    })
  }

  public async findAnonCredsCredentialDefinition(options: {
    schemaId?: string
    issuerId?: string
    name?: string
    version?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    const { name, version, schemaId, issuerId, relatedJsonSchemaCredentialId } = options

    const agent = await this.agentService.getAgent()

    const [credentialDefinitionRecord] = await agent.modules.anoncreds.getCreatedCredentialDefinitions({
      schemaId,
      issuerId,
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
    issuerId?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    if (options.schemaId) {
      const schemaRecord = await this.findAnonCredsSchema({ schemaId: options.schemaId })
      if (!schemaRecord) {
        throw new Error(`Schema not found for schemaId: ${options.schemaId}`)
      }
      return {
        schemaId: schemaRecord.schemaId,
        issuerId: schemaRecord.schema.issuerId,
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
    let schemaRecord = await this.findAnonCredsSchema(options)

    if (schemaRecord) {
      schemaId = schemaRecord.schemaId
      schema = schemaRecord.schema
      return {
        schemaId: schemaRecord.schemaId,
        issuerId: agent.did,
        schema: schemaRecord.schema,
      }
    } else {
      // No schema found. A new one will be created
      const parsedJsc = options.relatedJsonSchemaCredentialId
        ? await this.parseJsonSchemaCredential(options.relatedJsonSchemaCredentialId)
        : undefined
      const schemaAttributes = options.attributes ?? parsedJsc?.attrNames
      const schemaName = options.name ?? parsedJsc?.title

      if (!schemaAttributes || !schemaName) {
        throw new Error('Schema must include both name and attributes (provided or derived from JSON Schema)')
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
      const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)
      schemaRecord = (await schemaRepository.findBySchemaId(agent.context, schemaId)) ?? undefined
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
    return { issuerId: agent.did, schemaId, schema }
  }

  public async registerAnonCredsCredentialDefinition(options: {
    name: string
    schemaId: string
    issuerId: string
    supportRevocation?: boolean
    version?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    const {
      name,
      schemaId,
      issuerId,
      supportRevocation = false,
      version = '1.0',
      relatedJsonSchemaCredentialId,
    } = options
    const agent = await this.agentService.getAgent()

    const credentialDefinitionRegistrationOptions = {
      supportRevocation,
      extraMetadata: {
        relatedJsonSchemaCredentialId,
      },
    }

    const { credentialDefinitionState, registrationMetadata: credDefMetadata } =
      await agent.modules.anoncreds.registerCredentialDefinition({
        credentialDefinition: { issuerId, schemaId, tag: `${name}.${version}` },
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
    issuerId,
    supportRevocation = false,
    version = '1.0',
    attributes,
    relatedJsonSchemaCredentialId,
  }: {
    name?: string
    schemaId?: string
    issuerId?: string
    attributes?: string[]
    supportRevocation?: boolean
    version?: string
    relatedJsonSchemaCredentialId?: string
  }) {
    let credentialDefinitionRecord = await this.findAnonCredsCredentialDefinition({
      schemaId,
      issuerId,
      name,
      version,
      relatedJsonSchemaCredentialId,
    })
    if (credentialDefinitionRecord) return credentialDefinitionRecord

    // Credential definition not found: create an appropriate schema for it
    const {
      schema,
      schemaId: resolvedSchemaId,
      issuerId: resolvedIssuerId,
    } = await this.getOrRegisterAnonCredsSchema({
      name,
      version,
      issuerId,
      attributes,
      relatedJsonSchemaCredentialId,
    })
    credentialDefinitionRecord = await this.registerAnonCredsCredentialDefinition({
      name: schema.name,
      version: schema.version,
      schemaId: resolvedSchemaId,
      issuerId: resolvedIssuerId,
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
