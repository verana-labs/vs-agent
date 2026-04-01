import {
  AnonCredsCredentialDefinition,
  AnonCredsCredentialDefinitionPrivateRecord,
  AnonCredsCredentialDefinitionPrivateRepository,
  AnonCredsCredentialDefinitionRecord,
  AnonCredsCredentialDefinitionRepository,
  AnonCredsKeyCorrectnessProofRecord,
  AnonCredsKeyCorrectnessProofRepository,
  AnonCredsRevocationRegistryDefinitionRepository,
  AnonCredsSchema,
  AnonCredsSchemaRecord,
  AnonCredsSchemaRepository,
} from '@credo-ts/anoncreds'
import { Proof, utils } from '@credo-ts/core'
import { WebVhAnonCredsRegistry } from '@credo-ts/webvh'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  getSchemaPath,
  ApiParam,
} from '@nestjs/swagger'
import {
  CredentialTypeInfo,
  CredentialTypeResult,
  ImportCredentialTypeOptions,
} from '@verana-labs/vs-agent-model'

import { VsAgentService } from '../../../services/VsAgentService'

import { CreateRevocationRegistryDto } from './CreateRevocationRegistryDto'
import { CreateCredentialTypeDto } from './CredentialTypeDto'
import { CredentialTypesService } from './CredentialTypeService'

@ApiTags('credential-types')
@Controller({
  path: 'credential-types',
  version: '1',
})
export class CredentialTypesController {
  private readonly logger = new Logger(CredentialTypesController.name)

  constructor(
    private readonly agentService: VsAgentService,
    private readonly service: CredentialTypesService,
  ) {}

  /**
   * Get all created credential types
   *
   * @returns
   */
  @Get('/')
  @ApiOkResponse({
    description: 'An array of credential type results',
    type: CreateCredentialTypeDto,
    isArray: true,
  })
  public async getAllCredentialTypes(): Promise<CredentialTypeResult[]> {
    const agent = await this.agentService.getAgent()

    const credentialDefinitions = await agent.modules.anoncreds.getCreatedCredentialDefinitions({})

    return Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      credentialDefinitions.map(async (record: any) => {
        const schemaResult = await agent.modules.anoncreds.getSchema(record.credentialDefinition.schemaId)

        const schema = schemaResult.schema
        const revocationSupported = record.credentialDefinition?.value?.revocation !== undefined

        return {
          id: record.credentialDefinitionId,
          name: (record.getTag('name') as string) ?? schema?.name,
          version: (record.getTag('version') as string) ?? schema?.version,
          attributes: schema?.attrNames || [],
          revocationSupported,
          relatedJsonSchemaCredentialId: record.getTag('relatedJsonSchemaCredentialId') as string,
        }
      }),
    )
  }

  /**
   * Create a new credential type
   *
   * @param options
   * @returns CredentialTypeInfo
   */
  @Post('/')
  @ApiOperation({ summary: 'Create a new credential type' })
  @ApiBody({
    description: 'Payload to create a new AnonCreds credential definition',
    type: CreateCredentialTypeDto,
    examples: {
      phoneNumber: {
        summary: 'Phone Number VC',
        value: {
          name: 'phoneNumber',
          version: '1.0',
          attributes: ['phoneNumber'],
          supportRevocation: true,
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Created credential type info',
    type: CreateCredentialTypeDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid request payload' })
  public async createCredentialType(@Body() options: CreateCredentialTypeDto): Promise<CredentialTypeInfo> {
    const { relatedJsonSchemaCredentialId, attributes, name, version, supportRevocation } = options
    if (relatedJsonSchemaCredentialId && attributes) {
      throw new BadRequestException(
        'Either relatedJsonSchemaCredentialId or attributes must be specified, but not both.',
      )
    } else if (!relatedJsonSchemaCredentialId && !attributes) {
      throw new BadRequestException('Either relatedJsonSchemaCredentialId or attributes must be specified.')
    }

    try {
      let credentialDefinitionRecord = await this.service.findAnonCredsCredentialDefinition({
        name,
        version,
      })

      if (credentialDefinitionRecord) {
        throw new BadRequestException(
          `Credential type with name "${name}", version "${version}" already exists.`,
        )
      }

      const { schema, schemaId } = await this.service.getOrRegisterAnonCredsSchema(options)
      credentialDefinitionRecord = await this.service.registerAnonCredsCredentialDefinition({
        name,
        version,
        schemaId: schemaId,
        issuerId: schema.issuerId,
        supportRevocation,
        relatedJsonSchemaCredentialId,
      })

      return {
        id: credentialDefinitionRecord.credentialDefinitionId,
        name: schema.name,
        version: schema.version,
        attributes: schema.attrNames || [],
        supportRevocation,
        relatedJsonSchemaCredentialId: credentialDefinitionRecord.getTag(
          'relatedJsonSchemaCredentialId',
        ) as string,
      }
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      )
    }
  }

  /**
   * Delete a credential type, including its underlying cryptographic data
   *
   * @param credentialTypeId Credential Type Id
   * @returns ConnectionRecord
   */
  @Delete('/:credentialTypeId')
  @ApiOperation({ summary: 'Delete a credential type and all its crypto data' })
  @ApiQuery({
    name: 'credentialTypeId',
    description: 'Identifier of the credential definition to delete',
    example: 'VcDef:issuer:1234:TAG:1',
  })
  @ApiOkResponse({ description: 'Credential type deleted successfully (204 No Content)' })
  @ApiBadRequestResponse({ description: 'Invalid credentialTypeId' })
  public async deleteCredentialTypeById(@Query('credentialTypeId') credentialTypeId: string) {
    const agent = await this.agentService.getAgent()

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )
    const credentialDefinitionPrivateRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionPrivateRepository,
    )
    const keyCorrectnessProofRepository = agent.dependencyManager.resolve(
      AnonCredsKeyCorrectnessProofRepository,
    )

    const credentialDefinitionRecord = await credentialDefinitionRepository.findByCredentialDefinitionId(
      agent.context,
      credentialTypeId,
    )
    if (!credentialDefinitionRecord)
      throw new NotFoundException({ reason: `credential type with id "${credentialTypeId}" not found.` })

    // Delete private data
    const credDefPrivRecord = await credentialDefinitionPrivateRepository.getByCredentialDefinitionId(
      agent.context,
      credentialTypeId,
    )
    await credentialDefinitionPrivateRepository.delete(agent.context, credDefPrivRecord)

    const keyCorrectnessProofRecord = await keyCorrectnessProofRepository.getByCredentialDefinitionId(
      agent.context,
      credentialTypeId,
    )
    await keyCorrectnessProofRepository.delete(agent.context, keyCorrectnessProofRecord)

    // Delete public data
    await credentialDefinitionRepository.delete(agent.context, credentialDefinitionRecord)

    // TODO: shall we delete also schema?
  }

  /**
   * Export a credential type, including its underlying cryptographic data for importing it in another instance
   *
   * @param credentialTypeId Credential Type Id
   * @returns ConnectionRecord
   */
  @Get('/export/:credentialTypeId')
  @ApiOperation({ summary: 'Export a credential type for import elsewhere' })
  @ApiParam({
    name: 'credentialTypeId',
    description: 'Identifier of the credential definition to export',
    example: 'VcDef:issuer:1234:TAG:1',
  })
  @ApiOkResponse({
    description: 'Exported credential type package',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        data: { type: 'object' },
      },
    },
  })
  public async exportCredentialTypeById(@Param('credentialTypeId') credentialTypeId: string) {
    const agent = await this.agentService.getAgent()

    const credentialDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionRepository,
    )
    const credentialDefinitionPrivateRepository = agent.dependencyManager.resolve(
      AnonCredsCredentialDefinitionPrivateRepository,
    )
    const keyCorrectnessProofRepository = agent.dependencyManager.resolve(
      AnonCredsKeyCorrectnessProofRepository,
    )
    const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)

    const credentialDefinitionRecord = await credentialDefinitionRepository.findByCredentialDefinitionId(
      agent.context,
      credentialTypeId,
    )

    if (!credentialDefinitionRecord)
      throw new NotFoundException({ reason: `credential type with id "${credentialTypeId}" not found.` })

    return {
      id: credentialTypeId,
      data: {
        name: credentialDefinitionRecord.getTag('name'),
        version: credentialDefinitionRecord.getTag('version'),
        credentialDefinition: credentialDefinitionRecord.credentialDefinition,
        credentialDefinitionPrivate: (
          await credentialDefinitionPrivateRepository.getByCredentialDefinitionId(
            agent.context,
            credentialTypeId,
          )
        ).value,
        keyCorrectnessProof: (
          await keyCorrectnessProofRepository.getByCredentialDefinitionId(agent.context, credentialTypeId)
        ).value,
        schema: (
          await schemaRepository.findBySchemaId(
            agent.context,
            credentialDefinitionRecord.credentialDefinition.schemaId,
          )
        )?.schema,
      },
    }
  }

  /**
   * Create a new credential type
   *
   * @param options
   * @returns CredentialExchangeRecord
   */
  @Post('/import')
  @ApiOperation({ summary: 'Import a credential type package' })
  @ApiBody({
    description: 'Credential definition package for import',
    schema: { $ref: getSchemaPath(CreateCredentialTypeDto) },
  })
  @ApiOkResponse({
    description: 'Imported credential type info',
    type: CreateCredentialTypeDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid import package' })
  public async importCredentialType(
    @Body() options: ImportCredentialTypeOptions,
  ): Promise<CredentialTypeInfo> {
    const agent = await this.agentService.getAgent()

    try {
      const credentialDefinitionRepository = agent.dependencyManager.resolve(
        AnonCredsCredentialDefinitionRepository,
      )
      const credentialDefinitionPrivateRepository = agent.dependencyManager.resolve(
        AnonCredsCredentialDefinitionPrivateRepository,
      )
      const keyCorrectnessProofRepository = agent.dependencyManager.resolve(
        AnonCredsKeyCorrectnessProofRepository,
      )
      const schemaRepository = agent.dependencyManager.resolve(AnonCredsSchemaRepository)

      if (await credentialDefinitionRepository.findByCredentialDefinitionId(agent.context, options.id)) {
        throw new Error('Credential type already exists')
      }

      if (!agent.did) {
        throw new Error('Agent does not have any defined public DID')
      }

      const credentialDefinition = options.data
        .credentialDefinition as unknown as AnonCredsCredentialDefinition
      let schema = options.data.schema ? (options.data.schema as unknown as AnonCredsSchema) : undefined

      if (!schema) {
        // No schema specified. It must be retrieved from elsewhere
        const schemaState = await agent.modules.anoncreds.getSchema(credentialDefinition.schemaId)

        schema = schemaState.schema

        if (!schema) {
          throw new Error('Schema for given credential type has not been found')
        }
      }

      const existingSchemaRecord = await schemaRepository.findBySchemaId(
        agent.context,
        credentialDefinition.schemaId,
      )

      let schemaRecordId = existingSchemaRecord?.id
      if (!existingSchemaRecord) {
        schemaRecordId = utils.uuid()
        await schemaRepository.save(
          agent.context,
          new AnonCredsSchemaRecord({
            methodName: 'web',
            schema,
            schemaId: credentialDefinition.schemaId,
            id: schemaRecordId,
          }),
        )
      }
      const schemaRecord = await schemaRepository.getById(agent.context, schemaRecordId!)
      schemaRecord.setTag('schemaId', credentialDefinition.schemaId)
      await schemaRepository.update(agent.context, schemaRecord)

      const credentialDefinitionRecordId = utils.uuid()
      await credentialDefinitionRepository.save(
        agent.context,
        new AnonCredsCredentialDefinitionRecord({
          methodName: 'web',
          credentialDefinition,
          credentialDefinitionId: options.id,
          id: credentialDefinitionRecordId,
        }),
      )
      const credentialDefinitionRecord = await credentialDefinitionRepository.getById(
        agent.context,
        credentialDefinitionRecordId,
      )

      // Apply name and version as tags
      credentialDefinitionRecord.setTag('name', options.data.name)
      credentialDefinitionRecord.setTag('version', options.data.version)
      await credentialDefinitionRepository.update(agent.context, credentialDefinitionRecord)

      await credentialDefinitionPrivateRepository.save(
        agent.context,
        new AnonCredsCredentialDefinitionPrivateRecord({
          value: options.data.credentialDefinitionPrivate,
          credentialDefinitionId: options.id,
          id: credentialDefinitionRecordId,
        }),
      )

      await keyCorrectnessProofRepository.save(
        agent.context,
        new AnonCredsKeyCorrectnessProofRecord({
          value: options.data.keyCorrectnessProof,
          credentialDefinitionId: options.id,
          id: credentialDefinitionRecordId,
        }),
      )

      return {
        id: options.id,
        attributes: schema.attrNames,
        name: options.data.name,
        version: options.data.version,
        schemaId: credentialDefinition.schemaId,
      }
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: `something went wrong: ${error}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      )
    }
  }

  /**
   * Create a new revocation registry definition
   *
   * @param credentialDefinitionId
   * @returns RevocationTypeInfo
   */
  @Post('/revocationRegistry')
  @ApiOperation({ summary: 'Create a new revocation registry definition' })
  @ApiBody({
    description: 'Options to create a revocation registry',
    type: CreateRevocationRegistryDto,
  })
  @ApiOkResponse({
    description: 'Revocation registry definition identifier',
    schema: { example: 'RevRegDef:issuer:1234:TAG:default' },
  })
  public async createRevocationRegistry(@Body() options: CreateRevocationRegistryDto): Promise<string> {
    try {
      const agent = await this.agentService.getAgent()
      const credentialDefinitionId = options.credentialDefinitionId

      const cred = await agent.modules.anoncreds.getCredentialDefinition(credentialDefinitionId)

      if (!cred?.credentialDefinition?.value.revocation) {
        throw new Error(
          `No suitable revocation configuration found for the given credentialDefinitionId: ${credentialDefinitionId}`,
        )
      }
      const { revocationRegistryDefinitionState, registrationMetadata: revDefMetadata } =
        await agent.modules.anoncreds.registerRevocationRegistryDefinition({
          revocationRegistryDefinition: {
            credentialDefinitionId,
            tag: 'default',
            maximumCredentialNumber: options.maximumCredentialNumber,
            issuerId: cred.credentialDefinition.issuerId,
          },
          options: {},
        })
      const { attestedResource: revocationRegistration } = revDefMetadata as {
        attestedResource: Record<string, unknown>
      }
      const revocationRegistryDefinitionId = revocationRegistryDefinitionState.revocationRegistryDefinitionId
      if (!revocationRegistryDefinitionId) {
        throw new Error(`Cannot create credential revocations: ${JSON.stringify(revocationRegistration)}`)
      }
      this.logger.debug!(
        `revocationRegistryDefinitionState: ${JSON.stringify(revocationRegistryDefinitionState)}`,
      )

      // save registration metadata for webvh
      const revocationRecord = await this.service.saveAttestedResource(agent, revocationRegistration, {
        resourceType: 'anonCredsRevocRegDef',
      })

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
        throw new Error(`Failed to create revocation status list`)
      }
      const revocationDefinitionRepository = agent.dependencyManager.resolve(
        AnonCredsRevocationRegistryDefinitionRepository,
      )
      const revocationDefinitionRecord =
        await revocationDefinitionRepository.getByRevocationRegistryDefinitionId(
          agent.context,
          revocationRegistryDefinitionId,
        )

      // Update revocation definition with revocation status list and registration metadata
      if (statusRegistration && revocationRecord) {
        const timestamp = revocationStatusListState.revocationStatusList.timestamp
        const registry = new WebVhAnonCredsRegistry()
        const { registrationMetadata } = await registry.updateRevocationRegistryDefinition(
          agent.context,
          revocationRegistration as { proof?: Proof } & Record<string, object>,
          {
            links: [
              {
                id: statusRegistration.id as string,
                type: 'anonCredsStatusList',
                timestamp,
              },
            ],
          },
        )
        await this.service.saveAttestedResource(agent, statusRegistration, {
          resourceType: 'anonCredsStatusList',
        })

        revocationRecord.content = registrationMetadata
        await agent.genericRecords.update(revocationRecord)
      }

      revocationDefinitionRecord.metadata.set('revStatusList', revocationStatusListState.revocationStatusList)
      await revocationDefinitionRepository.update(agent.context, revocationDefinitionRecord)

      this.logger.log(`Revocation Registry Definition Id: ${revocationRegistryDefinitionId}`)

      return revocationRegistryDefinitionId
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: `something went wrong: ${error}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      )
    }
  }

  /**
   * Get all revocation definitions by credentialDefinitionId
   *
   * @returns string[] with revocationRegistryDefinitionIds
   */
  @Get('/revocationRegistry')
  @ApiOperation({ summary: 'List revocation registry definitions' })
  @ApiQuery({
    name: 'credentialDefinitionId',
    required: false,
    description: 'Filter registries for a specific credential definition',
    example: 'VcDef:issuer:1234:TAG:1',
  })
  @ApiOkResponse({
    description: 'Array of revocation registry definition IDs',
    schema: {
      type: 'array',
      items: { type: 'string' },
      example: ['RevRegDef:issuer:1234:TAG:default'],
    },
  })
  public async getRevocationDefinitions(
    @Query('credentialDefinitionId') credentialDefinitionId?: string,
  ): Promise<string[]> {
    const agent = await this.agentService.getAgent()

    const revocationDefinitionRepository = agent.dependencyManager.resolve(
      AnonCredsRevocationRegistryDefinitionRepository,
    )
    let revocationRegistries
    if (!credentialDefinitionId) {
      revocationRegistries = await revocationDefinitionRepository.getAll(agent.context)
    } else {
      revocationRegistries = await revocationDefinitionRepository.findAllByCredentialDefinitionId(
        agent.context,
        credentialDefinitionId,
      )
    }
    const revocationRegistryDefinitionIds = revocationRegistries.map(
      item => item.revocationRegistryDefinitionId,
    )

    return revocationRegistryDefinitionIds
  }
}
